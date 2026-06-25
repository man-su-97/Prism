from __future__ import annotations

import logging

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from app.config import get_settings
from app.deps.auth import (
    Principal,
    UserPrincipal,
    principal,
    principal_user_only,
)
from app.services import billing, minio_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["me"])
settings = get_settings()


def _sync_engine() -> sa.Engine:
    # Sync driver for transactional bookkeeping. Mirrors routers/billing.py.
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg")
    return sa.create_engine(sync_url, pool_pre_ping=True, future=True)


@router.get("/me")
async def me(p: Principal = Depends(principal)) -> dict[str, str]:
    return {"user_id": p.user_id, "org_id": p.org_id}


# ─── Account teardown ────────────────────────────────────────────────────
#
# A signed-in user's right to erasure (GDPR Art. 17) requires that we
# delete their personal data — including the workspaces they're the sole
# member of, since those are an extension of their identity in this app.
# Shared workspaces (where other members rely on the data) instead get
# the user removed from membership, with ownership transferred when they
# were the only owner.


class SoloWorkspace(BaseModel):
    id: str
    name: str
    has_billing: bool


class LeavingWorkspace(BaseModel):
    id: str
    name: str
    role: str


class TransferWorkspace(BaseModel):
    id: str
    name: str
    successor_user_id: str
    successor_member_id: str


class WorkspaceBlocker(BaseModel):
    id: str
    name: str
    reason: str  # only "no_admin_successor" today


class TeardownPreview(BaseModel):
    solo_workspaces: list[SoloWorkspace]
    shared_workspaces_leaving: list[LeavingWorkspace]
    shared_workspaces_transfer: list[TransferWorkspace]
    blockers: list[WorkspaceBlocker]


def _categorize(engine: sa.Engine, user_id: str) -> TeardownPreview:
    """Walk the user's memberships and bucket each workspace.

    No RLS context required: organization, member, subscriptions(stripe
    presence only) and friends are read with no app.org_id GUC. The
    subscriptions read is wrapped in a permissive context just to confirm
    whether a row exists.
    """
    with engine.connect() as conn:
        memberships = conn.execute(
            text(
                """
                SELECT m.id AS member_id, m.role AS role,
                       o.id AS org_id, o.name AS org_name
                FROM member m
                JOIN organization o ON o.id = m."organizationId"
                WHERE m."userId" = :uid
                """
            ),
            {"uid": user_id},
        ).all()

        solo: list[SoloWorkspace] = []
        leaving: list[LeavingWorkspace] = []
        transfer: list[TransferWorkspace] = []
        blockers: list[WorkspaceBlocker] = []

        for ms in memberships:
            others = conn.execute(
                text(
                    """
                    SELECT "userId" AS user_id, id AS member_id, role,
                           "createdAt" AS created_at
                    FROM member
                    WHERE "organizationId" = :org AND "userId" <> :uid
                    ORDER BY "createdAt" ASC
                    """
                ),
                {"org": ms.org_id, "uid": user_id},
            ).all()

            if not others:
                # Sole member — workspace and all tenant data will be torn down.
                conn.execute(
                    text("SELECT set_config('app.org_id', :o, false)"),
                    {"o": ms.org_id},
                )
                sub_row = conn.execute(
                    text(
                        "SELECT stripe_subscription_id FROM subscriptions"
                        " WHERE org_id = :o"
                    ),
                    {"o": ms.org_id},
                ).first()
                has_billing = bool(sub_row and sub_row.stripe_subscription_id)
                solo.append(
                    SoloWorkspace(
                        id=ms.org_id, name=ms.org_name, has_billing=has_billing
                    )
                )
                continue

            # Multi-member workspace.
            other_owners = [o for o in others if o.role == "owner"]
            other_admins = [o for o in others if o.role == "admin"]
            if ms.role != "owner" or other_owners:
                leaving.append(
                    LeavingWorkspace(
                        id=ms.org_id, name=ms.org_name, role=ms.role
                    )
                )
                continue

            # User is the only owner. Look for an admin successor.
            if other_admins:
                successor = other_admins[0]
                transfer.append(
                    TransferWorkspace(
                        id=ms.org_id,
                        name=ms.org_name,
                        successor_user_id=successor.user_id,
                        successor_member_id=successor.member_id,
                    )
                )
            else:
                blockers.append(
                    WorkspaceBlocker(
                        id=ms.org_id,
                        name=ms.org_name,
                        reason="no_admin_successor",
                    )
                )

    return TeardownPreview(
        solo_workspaces=solo,
        shared_workspaces_leaving=leaving,
        shared_workspaces_transfer=transfer,
        blockers=blockers,
    )


@router.get("/me/account-teardown/preview", response_model=TeardownPreview)
async def preview_teardown(
    p: UserPrincipal = Depends(principal_user_only),
) -> TeardownPreview:
    return _categorize(_sync_engine(), p.user_id)


class TeardownResult(BaseModel):
    status: str
    deleted_workspaces: int
    left_workspaces: int
    transferred_workspaces: int


@router.post("/me/account-teardown", response_model=TeardownResult)
async def run_teardown(
    p: UserPrincipal = Depends(principal_user_only),
) -> TeardownResult:
    engine = _sync_engine()
    preview = _categorize(engine, p.user_id)
    if preview.blockers:
        # Server is authoritative — refuse even if the UI somehow misses one.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ownership_transfer_required",
                "blockers": [b.model_dump() for b in preview.blockers],
            },
        )

    solo_ids = [w.id for w in preview.solo_workspaces]
    leaving_ids = [w.id for w in preview.shared_workspaces_leaving]
    transfer_specs = list(preview.shared_workspaces_transfer)

    # ─── Part 1: DB work in a single transaction ─────────────────────────
    with engine.begin() as conn:
        # 1a. Transfer ownership BEFORE the user's `member` row is deleted.
        for spec in transfer_specs:
            conn.execute(
                text("UPDATE member SET role = 'owner' WHERE id = :mid"),
                {"mid": spec.successor_member_id},
            )

        # 1b. Anonymize the user's PII in shared workspaces. datasets
        #     created_by_user_id is now nullable (migration 20260513_0002).
        for org_id in leaving_ids + [s.id for s in transfer_specs]:
            conn.execute(
                text("SELECT set_config('app.org_id', :o, false)"),
                {"o": org_id},
            )
            conn.execute(
                text(
                    "UPDATE datasets SET created_by_user_id = NULL"
                    " WHERE created_by_user_id = :uid"
                ),
                {"uid": p.user_id},
            )

        # 1c. Drop the user from shared workspaces. (member.userId would
        #     also cascade-delete when Better Auth deletes the user row,
        #     but doing it now keeps the audit trail in this single tx.)
        if leaving_ids or transfer_specs:
            shared = leaving_ids + [s.id for s in transfer_specs]
            conn.execute(
                text(
                    'DELETE FROM member WHERE "userId" = :uid'
                    ' AND "organizationId" = ANY(:orgs)'
                ),
                {"uid": p.user_id, "orgs": shared},
            )

        # 1d. Tear down each solo workspace's tenant data.
        for org_id in solo_ids:
            conn.execute(
                text("SELECT set_config('app.org_id', :o, false)"),
                {"o": org_id},
            )
            # datasets is the head of the cascade chain — deleting these
            # rows cascades to dataset_columns, dashboards, widgets,
            # chat_sessions and chat_messages via existing FK ondelete.
            conn.execute(
                text("DELETE FROM datasets WHERE org_id = :o"),
                {"o": org_id},
            )
            conn.execute(
                text("DELETE FROM subscriptions WHERE org_id = :o"),
                {"o": org_id},
            )

        # 1e. Delete the organization rows last. FK cascades on member
        #     and invitation clear the remaining bookkeeping.
        for org_id in solo_ids:
            conn.execute(
                text("DELETE FROM organization WHERE id = :o"),
                {"o": org_id},
            )

    # ─── Part 2: cross-service cleanup AFTER DB commit ───────────────────
    # Cancel Stripe subs first so the inbound webhook (which finds no
    # subscriptions row) just logs and exits.
    for ws in preview.solo_workspaces:
        if ws.has_billing:
            try:
                billing.cancel_subscription(engine, ws.id)
            except Exception:
                logger.exception("stripe cancel failed for org %s", ws.id)

    # Flush parquet + upload staging blobs. Best-effort: a failure here
    # leaves orphan objects but the PII is already gone from Postgres.
    for org_id in solo_ids:
        try:
            minio_client.remove_prefix(f"{org_id}/")
        except Exception:
            logger.exception("minio sweep failed for org %s", org_id)

    return TeardownResult(
        status="ok",
        deleted_workspaces=len(solo_ids),
        left_workspaces=len(leaving_ids),
        transferred_workspaces=len(transfer_specs),
    )
