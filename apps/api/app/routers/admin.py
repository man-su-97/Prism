"""Read-only super-admin portal endpoints.

Auth: every route depends on `require_super_admin` (or the
`admin_session` wrapper for tenant-table reads). Both refuse with 404 —
the portal must not reveal its own existence to non-allowlisted callers.

Scope: v1 is strictly read-only. Do not add an INSERT/UPDATE/DELETE here
without first lifting CLAUDE.md's "Super-admin portal is read-only"
invariant. The bypass policies in migration 20260514_0003 are FOR SELECT
only, so a write attempt would fail at the policy layer anyway.
"""
from __future__ import annotations

import base64
import logging
from datetime import UTC, date, datetime
from typing import Any

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionFactory
from app.deps.auth import (
    SuperAdminPrincipal,
    admin_session,
    require_super_admin,
)
from app.services.plans import get_plan

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Arq's default queue Redis key. If WorkerSettings ever sets a custom
# queue_name in apps/api/app/worker.py, update this string too.
ARQ_QUEUE_KEY = "arq:queue"
ARQ_IN_PROGRESS_PREFIX = "arq:in-progress:"


# ── Response models ────────────────────────────────────────────────────────


class AdminOverview(BaseModel):
    total_users: int
    total_workspaces: int
    workspaces_by_plan: dict[str, int]
    active_sessions_24h: int
    chat_messages_30d: int
    datasets_total: int
    datasets_in_error: int
    new_users_7d: int
    new_workspaces_7d: int
    generated_at: datetime


class AdminUserListItem(BaseModel):
    id: str
    email: str
    name: str | None
    email_verified: bool
    created_at: datetime
    last_active_at: datetime | None
    workspace_count: int


class AdminUserList(BaseModel):
    items: list[AdminUserListItem]
    next_cursor: str | None


class AdminMembership(BaseModel):
    organization_id: str
    name: str
    slug: str
    role: str
    joined_at: datetime


class AdminUserSession(BaseModel):
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    ip_address: str | None
    user_agent: str | None


class AdminUserDetail(BaseModel):
    id: str
    email: str
    name: str | None
    image: str | None
    email_verified: bool
    created_at: datetime
    updated_at: datetime
    memberships: list[AdminMembership]
    recent_sessions: list[AdminUserSession]


class AdminWorkspaceListItem(BaseModel):
    id: str
    name: str
    slug: str
    created_at: datetime
    plan: str
    status: str | None
    member_count: int
    dataset_count: int
    dashboard_count: int
    chat_tokens_used: int
    chat_tokens_limit: int
    current_period_end: datetime | None
    chat_tokens_period_end: datetime | None


class AdminWorkspaceList(BaseModel):
    items: list[AdminWorkspaceListItem]
    next_cursor: str | None


class AdminWorkspaceMember(BaseModel):
    user_id: str
    email: str
    name: str | None
    role: str
    joined_at: datetime


class AdminWorkspaceDataset(BaseModel):
    id: str
    name: str
    status: str
    row_count: int | None
    size_bytes: int | None
    created_at: datetime


class AdminWorkspaceDashboard(BaseModel):
    id: str
    name: str
    kind: str
    widget_count: int
    created_at: datetime


class AdminWorkspaceDetail(BaseModel):
    workspace: AdminWorkspaceListItem
    members: list[AdminWorkspaceMember]
    recent_datasets: list[AdminWorkspaceDataset]
    recent_dashboards: list[AdminWorkspaceDashboard]


class AdminTimeSeriesPoint(BaseModel):
    bucket: date
    value: int


class AdminTimeSeries(BaseModel):
    points: list[AdminTimeSeriesPoint]
    total: int
    days: int


class AdminSystemHealth(BaseModel):
    redis_ok: bool
    postgres_ok: bool
    arq_queue_depth: int
    arq_in_progress: int
    datasets_error_count: int
    pg_connection_count: int
    generated_at: datetime


# ── Helpers ────────────────────────────────────────────────────────────────


def _encode_cursor(ts: datetime, id_: str) -> str:
    raw = f"{ts.isoformat()}|{id_}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, str] | None:
    if not cursor:
        return None
    pad = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(cursor + pad).decode()
        ts_str, id_ = raw.split("|", 1)
        return datetime.fromisoformat(ts_str), id_
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="bad_cursor"
        ) from exc


def _plan_chat_limit(plan_name: str | None) -> int:
    return get_plan(plan_name).chat_tokens_per_month


# ── Endpoints ──────────────────────────────────────────────────────────────


@router.get("/overview", response_model=AdminOverview)
async def overview(
    _: SuperAdminPrincipal = Depends(require_super_admin),
    session: AsyncSession = Depends(admin_session),
) -> AdminOverview:
    row = (
        await session.execute(
            text(
                """
                SELECT
                  (SELECT COUNT(*)::int FROM "user") AS total_users,
                  (SELECT COUNT(*)::int FROM "organization") AS total_workspaces,
                  (SELECT COUNT(*)::int FROM "session"
                     WHERE "updatedAt" > NOW() - INTERVAL '24 hours'
                       AND "expiresAt" > NOW()) AS active_sessions_24h,
                  (SELECT COUNT(*)::int FROM chat_messages
                     WHERE role = 'user'
                       AND created_at > NOW() - INTERVAL '30 days') AS chat_messages_30d,
                  (SELECT COUNT(*)::int FROM datasets) AS datasets_total,
                  (SELECT COUNT(*)::int FROM datasets WHERE status = 'error') AS datasets_in_error,
                  (SELECT COUNT(*)::int FROM "user"
                     WHERE "createdAt" > NOW() - INTERVAL '7 days') AS new_users_7d,
                  (SELECT COUNT(*)::int FROM "organization"
                     WHERE "createdAt" > NOW() - INTERVAL '7 days') AS new_workspaces_7d
                """
            )
        )
    ).one()

    # Plan distribution: orgs with no subscriptions row are implicitly Free.
    plan_rows = (
        await session.execute(
            text(
                """
                SELECT COALESCE(s.plan, 'free') AS plan, COUNT(*)::int AS c
                FROM "organization" o
                LEFT JOIN subscriptions s ON s.org_id = o.id
                GROUP BY 1
                """
            )
        )
    ).all()
    by_plan: dict[str, int] = {r.plan: r.c for r in plan_rows}

    return AdminOverview(
        total_users=row.total_users,
        total_workspaces=row.total_workspaces,
        workspaces_by_plan=by_plan,
        active_sessions_24h=row.active_sessions_24h,
        chat_messages_30d=row.chat_messages_30d,
        datasets_total=row.datasets_total,
        datasets_in_error=row.datasets_in_error,
        new_users_7d=row.new_users_7d,
        new_workspaces_7d=row.new_workspaces_7d,
        generated_at=datetime.now(UTC),
    )


@router.get("/users", response_model=AdminUserList)
async def list_users(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    me: SuperAdminPrincipal = Depends(require_super_admin),
) -> AdminUserList:
    cursor_pair = _decode_cursor(cursor)
    # Hide the calling admin's own row from the list — the portal is for
    # looking at other people; seeing yourself is just noise.
    params: dict[str, Any] = {"limit": limit + 1, "self_id": me.user_id}
    where: list[str] = ["u.id <> :self_id"]

    if cursor_pair is not None:
        where.append('(u."createdAt", u.id) < (:cur_ts, :cur_id)')
        params["cur_ts"] = cursor_pair[0]
        params["cur_id"] = cursor_pair[1]
    if search:
        where.append('(u.email ILIKE :q OR u.name ILIKE :q)')
        params["q"] = f"%{search}%"

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT
          u.id, u.email, u.name, u."emailVerified" AS email_verified,
          u."createdAt" AS created_at,
          (SELECT MAX("updatedAt") FROM "session" WHERE "userId" = u.id) AS last_active_at,
          (SELECT COUNT(*)::int FROM member WHERE "userId" = u.id) AS workspace_count
        FROM "user" u
        {where_sql}
        ORDER BY u."createdAt" DESC, u.id DESC
        LIMIT :limit
    """

    async with SessionFactory() as s:
        rows = (await s.execute(text(sql), params)).all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = (
        _encode_cursor(items[-1].created_at, items[-1].id) if has_more and items else None
    )

    return AdminUserList(
        items=[
            AdminUserListItem(
                id=r.id,
                email=r.email,
                name=r.name,
                email_verified=bool(r.email_verified),
                created_at=r.created_at,
                last_active_at=r.last_active_at,
                workspace_count=r.workspace_count,
            )
            for r in items
        ],
        next_cursor=next_cursor,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def user_detail(
    user_id: str,
    _: SuperAdminPrincipal = Depends(require_super_admin),
) -> AdminUserDetail:
    async with SessionFactory() as s:
        user_row = (
            await s.execute(
                text(
                    """
                    SELECT id, email, name, image, "emailVerified" AS email_verified,
                           "createdAt" AS created_at, "updatedAt" AS updated_at
                    FROM "user" WHERE id = :uid
                    """
                ),
                {"uid": user_id},
            )
        ).first()
        if user_row is None:
            raise HTTPException(status_code=404, detail="user_not_found")

        membership_rows = (
            await s.execute(
                text(
                    """
                    SELECT o.id AS organization_id, o.name, o.slug,
                           m.role, m."createdAt" AS joined_at
                    FROM member m
                    JOIN "organization" o ON o.id = m."organizationId"
                    WHERE m."userId" = :uid
                    ORDER BY m."createdAt" DESC
                    """
                ),
                {"uid": user_id},
            )
        ).all()

        session_rows = (
            await s.execute(
                text(
                    """
                    SELECT "createdAt" AS created_at, "updatedAt" AS updated_at,
                           "expiresAt" AS expires_at,
                           "ipAddress" AS ip_address, "userAgent" AS user_agent
                    FROM "session"
                    WHERE "userId" = :uid
                    ORDER BY "updatedAt" DESC
                    LIMIT 5
                    """
                ),
                {"uid": user_id},
            )
        ).all()

    return AdminUserDetail(
        id=user_row.id,
        email=user_row.email,
        name=user_row.name,
        image=user_row.image,
        email_verified=bool(user_row.email_verified),
        created_at=user_row.created_at,
        updated_at=user_row.updated_at,
        memberships=[
            AdminMembership(
                organization_id=m.organization_id,
                name=m.name,
                slug=m.slug,
                role=m.role,
                joined_at=m.joined_at,
            )
            for m in membership_rows
        ],
        recent_sessions=[
            AdminUserSession(
                created_at=ss.created_at,
                updated_at=ss.updated_at,
                expires_at=ss.expires_at,
                ip_address=ss.ip_address,
                user_agent=ss.user_agent,
            )
            for ss in session_rows
        ],
    )


@router.get("/workspaces", response_model=AdminWorkspaceList)
async def list_workspaces(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    search: str | None = Query(default=None, max_length=200),
    plan: str | None = Query(default=None, max_length=32),
    _: SuperAdminPrincipal = Depends(require_super_admin),
    session: AsyncSession = Depends(admin_session),
) -> AdminWorkspaceList:
    cursor_pair = _decode_cursor(cursor)
    params: dict[str, Any] = {"limit": limit + 1}
    where: list[str] = []

    if cursor_pair is not None:
        where.append('(o."createdAt", o.id) < (:cur_ts, :cur_id)')
        params["cur_ts"] = cursor_pair[0]
        params["cur_id"] = cursor_pair[1]
    if search:
        where.append("(o.name ILIKE :q OR o.slug ILIKE :q)")
        params["q"] = f"%{search}%"
    if plan:
        where.append("COALESCE(s.plan, 'free') = :plan")
        params["plan"] = plan

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT
          o.id, o.name, o.slug, o."createdAt" AS created_at,
          COALESCE(s.plan, 'free') AS plan,
          s.status,
          s.current_period_end,
          s.chat_tokens_period_end,
          COALESCE(s.chat_tokens_used, 0) AS chat_tokens_used,
          (SELECT COUNT(*)::int FROM member WHERE "organizationId" = o.id) AS member_count,
          (SELECT COUNT(*)::int FROM datasets WHERE org_id = o.id) AS dataset_count,
          (SELECT COUNT(*)::int FROM dashboards WHERE org_id = o.id) AS dashboard_count
        FROM "organization" o
        LEFT JOIN subscriptions s ON s.org_id = o.id
        {where_sql}
        ORDER BY o."createdAt" DESC, o.id DESC
        LIMIT :limit
    """
    rows = (await session.execute(text(sql), params)).all()
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = (
        _encode_cursor(items[-1].created_at, items[-1].id) if has_more and items else None
    )

    return AdminWorkspaceList(
        items=[
            AdminWorkspaceListItem(
                id=r.id,
                name=r.name,
                slug=r.slug,
                created_at=r.created_at,
                plan=r.plan,
                status=r.status,
                member_count=r.member_count,
                dataset_count=r.dataset_count,
                dashboard_count=r.dashboard_count,
                chat_tokens_used=r.chat_tokens_used,
                chat_tokens_limit=_plan_chat_limit(r.plan),
                current_period_end=r.current_period_end,
                chat_tokens_period_end=r.chat_tokens_period_end,
            )
            for r in items
        ],
        next_cursor=next_cursor,
    )


@router.get("/workspaces/{org_id}", response_model=AdminWorkspaceDetail)
async def workspace_detail(
    org_id: str,
    _: SuperAdminPrincipal = Depends(require_super_admin),
    session: AsyncSession = Depends(admin_session),
) -> AdminWorkspaceDetail:
    head = (
        await session.execute(
            text(
                """
                SELECT
                  o.id, o.name, o.slug, o."createdAt" AS created_at,
                  COALESCE(s.plan, 'free') AS plan,
                  s.status,
                  s.current_period_end,
                  s.chat_tokens_period_end,
                  COALESCE(s.chat_tokens_used, 0) AS chat_tokens_used,
                  (SELECT COUNT(*)::int FROM member WHERE "organizationId" = o.id) AS member_count,
                  (SELECT COUNT(*)::int FROM datasets WHERE org_id = o.id) AS dataset_count,
                  (SELECT COUNT(*)::int FROM dashboards WHERE org_id = o.id) AS dashboard_count
                FROM "organization" o
                LEFT JOIN subscriptions s ON s.org_id = o.id
                WHERE o.id = :oid
                """
            ),
            {"oid": org_id},
        )
    ).first()
    if head is None:
        raise HTTPException(status_code=404, detail="workspace_not_found")

    member_rows = (
        await session.execute(
            text(
                """
                SELECT m."userId" AS user_id, u.email, u.name,
                       m.role, m."createdAt" AS joined_at
                FROM member m
                JOIN "user" u ON u.id = m."userId"
                WHERE m."organizationId" = :oid
                ORDER BY m."createdAt" ASC
                """
            ),
            {"oid": org_id},
        )
    ).all()

    dataset_rows = (
        await session.execute(
            text(
                """
                SELECT id, name, status, row_count, size_bytes, created_at
                FROM datasets
                WHERE org_id = :oid
                ORDER BY created_at DESC
                LIMIT 20
                """
            ),
            {"oid": org_id},
        )
    ).all()

    dashboard_rows = (
        await session.execute(
            text(
                """
                SELECT d.id, d.name, d.kind, d.created_at,
                  (SELECT COUNT(*)::int FROM widgets w WHERE w.dashboard_id = d.id) AS widget_count
                FROM dashboards d
                WHERE d.org_id = :oid
                ORDER BY d.created_at DESC
                LIMIT 20
                """
            ),
            {"oid": org_id},
        )
    ).all()

    ws = AdminWorkspaceListItem(
        id=head.id,
        name=head.name,
        slug=head.slug,
        created_at=head.created_at,
        plan=head.plan,
        status=head.status,
        member_count=head.member_count,
        dataset_count=head.dataset_count,
        dashboard_count=head.dashboard_count,
        chat_tokens_used=head.chat_tokens_used,
        chat_tokens_limit=_plan_chat_limit(head.plan),
        current_period_end=head.current_period_end,
        chat_tokens_period_end=head.chat_tokens_period_end,
    )

    return AdminWorkspaceDetail(
        workspace=ws,
        members=[
            AdminWorkspaceMember(
                user_id=m.user_id,
                email=m.email,
                name=m.name,
                role=m.role,
                joined_at=m.joined_at,
            )
            for m in member_rows
        ],
        recent_datasets=[
            AdminWorkspaceDataset(
                id=str(d.id),
                name=d.name,
                status=d.status,
                row_count=d.row_count,
                size_bytes=d.size_bytes,
                created_at=d.created_at,
            )
            for d in dataset_rows
        ],
        recent_dashboards=[
            AdminWorkspaceDashboard(
                id=str(d.id),
                name=d.name,
                kind=d.kind,
                widget_count=d.widget_count,
                created_at=d.created_at,
            )
            for d in dashboard_rows
        ],
    )


@router.get("/usage/signups", response_model=AdminTimeSeries)
async def usage_signups(
    days: int = Query(default=30, ge=1, le=90),
    _: SuperAdminPrincipal = Depends(require_super_admin),
) -> AdminTimeSeries:
    sql = """
        WITH series AS (
          SELECT generate_series(
            (NOW() AT TIME ZONE 'UTC')::date - (:days - 1),
            (NOW() AT TIME ZONE 'UTC')::date,
            INTERVAL '1 day'
          )::date AS bucket
        ),
        signups AS (
          SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS bucket, COUNT(*)::int AS c
          FROM "user"
          WHERE "createdAt" > NOW() - make_interval(days => :days)
          GROUP BY 1
        )
        SELECT s.bucket, COALESCE(g.c, 0)::int AS value
        FROM series s LEFT JOIN signups g USING (bucket)
        ORDER BY s.bucket ASC
    """
    async with SessionFactory() as ses:
        rows = (await ses.execute(text(sql), {"days": days})).all()
    points = [AdminTimeSeriesPoint(bucket=r.bucket, value=r.value) for r in rows]
    return AdminTimeSeries(points=points, total=sum(p.value for p in points), days=days)


@router.get("/usage/chat", response_model=AdminTimeSeries)
async def usage_chat(
    days: int = Query(default=30, ge=1, le=90),
    _: SuperAdminPrincipal = Depends(require_super_admin),
    session: AsyncSession = Depends(admin_session),
) -> AdminTimeSeries:
    sql = """
        WITH series AS (
          SELECT generate_series(
            (NOW() AT TIME ZONE 'UTC')::date - (:days - 1),
            (NOW() AT TIME ZONE 'UTC')::date,
            INTERVAL '1 day'
          )::date AS bucket
        ),
        msgs AS (
          SELECT (created_at AT TIME ZONE 'UTC')::date AS bucket, COUNT(*)::int AS c
          FROM chat_messages
          WHERE role = 'user'
            AND created_at > NOW() - make_interval(days => :days)
          GROUP BY 1
        )
        SELECT s.bucket, COALESCE(m.c, 0)::int AS value
        FROM series s LEFT JOIN msgs m USING (bucket)
        ORDER BY s.bucket ASC
    """
    rows = (await session.execute(text(sql), {"days": days})).all()
    points = [AdminTimeSeriesPoint(bucket=r.bucket, value=r.value) for r in rows]
    return AdminTimeSeries(points=points, total=sum(p.value for p in points), days=days)


async def _redis_client() -> redis.Redis:
    return redis.from_url(settings.redis_url, decode_responses=True)


@router.get("/system/health", response_model=AdminSystemHealth)
async def system_health(
    _: SuperAdminPrincipal = Depends(require_super_admin),
    session: AsyncSession = Depends(admin_session),
) -> AdminSystemHealth:
    queue_depth = 0
    in_progress = 0
    redis_ok = True
    client = await _redis_client()
    try:
        queue_depth = int(await client.zcard(ARQ_QUEUE_KEY))
        scan_cap = 0
        async for _key in client.scan_iter(match=f"{ARQ_IN_PROGRESS_PREFIX}*", count=200):
            in_progress += 1
            scan_cap += 1
            if scan_cap >= 1000:
                break
    except redis.RedisError as exc:
        logger.warning("admin/system/health redis read failed: %s", exc)
        redis_ok = False
    finally:
        try:
            await client.aclose()
        except Exception:  # pragma: no cover
            pass

    postgres_ok = True
    pg_conn_count = 0
    error_count = 0
    try:
        pg_row = (
            await session.execute(
                text(
                    "SELECT COUNT(*)::int AS c FROM pg_stat_activity "
                    "WHERE datname = current_database()"
                )
            )
        ).one()
        pg_conn_count = pg_row.c
        err_row = (
            await session.execute(
                text("SELECT COUNT(*)::int AS c FROM datasets WHERE status = 'error'")
            )
        ).one()
        error_count = err_row.c
    except Exception as exc:  # pragma: no cover  (RLS shouldn't block us)
        logger.warning("admin/system/health pg read failed: %s", exc)
        postgres_ok = False

    return AdminSystemHealth(
        redis_ok=redis_ok,
        postgres_ok=postgres_ok,
        arq_queue_depth=queue_depth,
        arq_in_progress=in_progress,
        datasets_error_count=error_count,
        pg_connection_count=pg_conn_count,
        generated_at=datetime.now(UTC),
    )
