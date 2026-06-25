from __future__ import annotations

import logging
import os
from pathlib import Path

import stripe
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.deps.auth import Principal, principal, tenant_session
from app.services import cache, minio_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

settings = get_settings()

# Mirrors datasets.py — these statuses mean a worker is still writing the
# parquet, so deleting the workspace mid-flight would race the worker.
_DELETE_BUSY_STATUSES = ("pending", "uploading", "ingesting")


class WorkspaceDeletePreview(BaseModel):
    workspace_id: str
    name: str
    datasets: int
    dashboards: int
    widgets: int
    chat_sessions: int
    share_links_active: int
    other_members: int
    has_billing: bool
    blocked_reason: str | None


async def _gather_preview(
    session: AsyncSession, p: Principal
) -> WorkspaceDeletePreview:
    counts_row = (
        await session.execute(
            text(
                """
                SELECT
                  (SELECT COUNT(*)::int FROM datasets) AS datasets,
                  (SELECT COUNT(*)::int FROM dashboards) AS dashboards,
                  (SELECT COUNT(*)::int FROM widgets) AS widgets,
                  (SELECT COUNT(*)::int FROM chat_sessions) AS chat_sessions,
                  (SELECT COUNT(*)::int FROM dashboard_shares
                     WHERE revoked_at IS NULL) AS share_links_active,
                  (SELECT COUNT(*)::int FROM datasets
                     WHERE status = ANY(:busy)) AS busy_datasets
                """
            ),
            {"busy": list(_DELETE_BUSY_STATUSES)},
        )
    ).one()

    name_row = (
        await session.execute(
            text('SELECT name FROM "organization" WHERE id = :id'),
            {"id": p.org_id},
        )
    ).first()
    workspace_name = name_row.name if name_row else ""

    role_row = (
        await session.execute(
            text(
                'SELECT role FROM member '
                'WHERE "userId" = :uid AND "organizationId" = :oid'
            ),
            {"uid": p.user_id, "oid": p.org_id},
        )
    ).first()
    role = role_row.role if role_row else None

    user_ws_count_row = (
        await session.execute(
            text('SELECT COUNT(*)::int AS c FROM member WHERE "userId" = :uid'),
            {"uid": p.user_id},
        )
    ).one()

    other_members_row = (
        await session.execute(
            text(
                'SELECT COUNT(*)::int AS c FROM member '
                'WHERE "organizationId" = :oid AND "userId" <> :uid'
            ),
            {"oid": p.org_id, "uid": p.user_id},
        )
    ).one()

    sub_row = (
        await session.execute(
            text(
                "SELECT stripe_subscription_id FROM subscriptions WHERE org_id = :o"
            ),
            {"o": p.org_id},
        )
    ).first()
    has_billing = bool(sub_row and sub_row.stripe_subscription_id)

    # Pick the first blocker that applies — UI surfaces a single reason.
    blocked: str | None = None
    if role != "owner":
        blocked = "not_workspace_owner"
    elif user_ws_count_row.c <= 1:
        blocked = "last_workspace"
    elif counts_row.busy_datasets > 0:
        blocked = "workspace_busy"

    return WorkspaceDeletePreview(
        workspace_id=p.org_id,
        name=workspace_name,
        datasets=counts_row.datasets,
        dashboards=counts_row.dashboards,
        widgets=counts_row.widgets,
        chat_sessions=counts_row.chat_sessions,
        share_links_active=counts_row.share_links_active,
        other_members=other_members_row.c,
        has_billing=has_billing,
        blocked_reason=blocked,
    )


@router.get("/delete-preview", response_model=WorkspaceDeletePreview)
async def delete_preview(
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> WorkspaceDeletePreview:
    return await _gather_preview(session, p)


def _cancel_stripe_subscription(subscription_id: str) -> None:
    # The DB commit has already wiped the subscriptions row, so
    # services.billing.cancel_subscription (which re-reads from DB) would
    # find nothing. Cancel directly via the Stripe SDK with the id we
    # captured pre-delete.
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        return
    try:
        stripe.StripeClient(api_key=key).subscriptions.cancel(subscription_id)
    except stripe.StripeError as exc:
        logger.warning(
            "stripe cancel for sub %s failed: %s", subscription_id, exc
        )


@router.post("/delete", status_code=204)
async def delete_workspace(
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> Response:
    """Tear down the active workspace and everything inside it.

    Mirrors the solo-workspace branch of account-teardown (routers/me.py) but
    scoped to one workspace, named implicitly by the JWT's org_id claim.
    """
    preview = await _gather_preview(session, p)
    if preview.blocked_reason:
        code = (
            status.HTTP_403_FORBIDDEN
            if preview.blocked_reason == "not_workspace_owner"
            else status.HTTP_409_CONFLICT
        )
        raise HTTPException(code, preview.blocked_reason)

    # Collect ids and external-resource keys BEFORE the DELETE — once rows are
    # gone we can't recover stripe ids, parquet paths, or widget ids.
    dataset_rows = await session.execute(
        text("SELECT parquet_path FROM datasets")
    )
    parquet_paths = [r.parquet_path for r in dataset_rows if r.parquet_path]

    widget_rows = await session.execute(text("SELECT id FROM widgets"))
    widget_ids = [r.id for r in widget_rows]

    sub_row = (
        await session.execute(
            text(
                "SELECT stripe_subscription_id FROM subscriptions "
                "WHERE org_id = :o"
            ),
            {"o": p.org_id},
        )
    ).first()
    stripe_sub_id = sub_row.stripe_subscription_id if sub_row else None

    # datasets is the head of the FK cascade — deleting cascades to
    # dataset_columns, dashboards, widgets, chat_sessions, chat_messages,
    # and dashboard_shares via existing ondelete rules.
    await session.execute(text("DELETE FROM datasets"))
    # tenant_probe carries org_id but no FK chain — sweep it explicitly.
    await session.execute(text("DELETE FROM tenant_probe"))
    await session.execute(text("DELETE FROM subscriptions"))
    # Better Auth's organization row has no RLS, FK-cascades to member +
    # invitation. The WHERE id filter scopes the delete.
    await session.execute(
        text('DELETE FROM "organization" WHERE id = :id'),
        {"id": p.org_id},
    )
    await session.commit()
    # No further SQL on `session` — `app.org_id` was set transaction-local
    # and is gone with the commit.

    # ── Post-commit cleanup (best-effort) ────────────────────────────────
    for parquet_path in parquet_paths:
        try:
            Path(parquet_path).unlink(missing_ok=True)
        except Exception:
            logger.exception("parquet unlink failed for %s", parquet_path)

    try:
        minio_client.remove_prefix(f"{p.org_id}/")
    except Exception:
        logger.exception("minio sweep failed for org %s", p.org_id)

    try:
        org_parquet_dir = Path(settings.parquet_root) / p.org_id
        if org_parquet_dir.is_dir():
            org_parquet_dir.rmdir()
    except OSError:
        logger.exception("parquet rmdir failed for org %s", p.org_id)

    for wid in widget_ids:
        try:
            await cache.bust_widget(wid)
        except Exception:
            logger.exception("widget cache bust failed for %s", wid)

    if stripe_sub_id:
        _cancel_stripe_subscription(stripe_sub_id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
