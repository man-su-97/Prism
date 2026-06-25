from __future__ import annotations

import csv
import io
import json
import logging
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import Principal, principal, tenant_session
from app.deps.limits import current_plan
from app.services import cache
from app.services.duck import (
    UnsafeSQLError,
    open_org_connection,
    run_query,
    view_for_dataset,
)
from app.services.plans import Plan
from app.services.share import mint as mint_share_token
from app.services.widget_builder import BuilderError, build_widget_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["dashboards"])


class WidgetOut(BaseModel):
    id: str
    kind: str
    title: str
    config: dict[str, Any]


class DashboardSummary(BaseModel):
    id: str
    dataset_id: str
    name: str
    kind: str
    created_at: str


class DashboardDetail(DashboardSummary):
    layout: list[dict[str, Any]]
    overview: str | None
    widgets: list[WidgetOut]


class DashboardDeletePreview(BaseModel):
    dashboard_id: str
    name: str
    widgets: int
    chat_sessions: int
    share_links_active: int


class LayoutPatch(BaseModel):
    layout: list[dict[str, Any]]


class DashboardCreate(BaseModel):
    dataset_id: uuid.UUID
    mode: Literal["blank", "duplicate"]
    name: str | None = Field(default=None, max_length=200)
    source_dashboard_id: uuid.UUID | None = None


class WidgetSpec(BaseModel):
    dashboard_id: uuid.UUID
    kind: str
    title: str = Field(min_length=1, max_length=120)
    x: str | None = None
    y: str | None = None
    aggregate: str | None = None
    label: str | None = None
    value: str | None = None
    time_bucket: str | None = None
    limit: int | None = None


class WidgetUpdate(BaseModel):
    kind: str | None = None
    title: str | None = None
    x: str | None = None
    y: str | None = None
    aggregate: str | None = None
    label: str | None = None
    value: str | None = None
    time_bucket: str | None = None
    limit: int | None = None


@router.get("/dashboards", response_model=list[DashboardSummary])
async def list_dashboards(
    session: AsyncSession = Depends(tenant_session),
) -> list[DashboardSummary]:
    result = await session.execute(
        text(
            "SELECT id, dataset_id, name, kind, created_at FROM dashboards "
            "ORDER BY created_at DESC"
        )
    )
    return [
        DashboardSummary(
            id=str(r.id),
            dataset_id=str(r.dataset_id),
            name=r.name,
            kind=r.kind,
            created_at=r.created_at.isoformat(),
        )
        for r in result
    ]


async def _default_dashboard_name(
    session: AsyncSession,
    dataset_id: uuid.UUID,
    mode: str,
    source_id: uuid.UUID | None,
    dataset_name: str,
) -> str:
    if mode == "duplicate" and source_id is not None:
        src_name = (
            await session.execute(
                text("SELECT name FROM dashboards WHERE id = :id"),
                {"id": source_id},
            )
        ).scalar()
        base = f"{src_name} (copy)" if src_name else "Dashboard (copy)"
    else:
        base = dataset_name or "Untitled dashboard"

    existing = {
        r.name
        for r in (
            await session.execute(
                text("SELECT name FROM dashboards WHERE dataset_id = :ds"),
                {"ds": dataset_id},
            )
        )
    }
    if base not in existing:
        return base
    n = 2
    while f"{base} {n}" in existing:
        n += 1
    return f"{base} {n}"


async def _duplicate_dashboard(
    session: AsyncSession,
    org_id: str,
    source_id: uuid.UUID,
    dataset_id: uuid.UUID,
    new_name: str,
) -> Any:
    src = (
        await session.execute(
            text(
                "SELECT id, dataset_id, layout_json, overview "
                "FROM dashboards WHERE id = :id"
            ),
            {"id": source_id},
        )
    ).first()
    if src is None or src.dataset_id != dataset_id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "dashboard_source_not_found"
        )

    new_dash = (
        await session.execute(
            text(
                """
                INSERT INTO dashboards
                  (org_id, dataset_id, name, kind, layout_json, overview)
                VALUES
                  (:org, :ds, :name, 'manual', CAST(:layout AS jsonb), :overview)
                RETURNING id, dataset_id, name, kind, created_at
                """
            ),
            {
                "org": org_id,
                "ds": dataset_id,
                "name": new_name,
                "layout": json.dumps(src.layout_json or []),
                "overview": src.overview,
            },
        )
    ).one()

    widgets_result = await session.execute(
        text(
            "SELECT id, kind, title, config_json FROM widgets "
            "WHERE dashboard_id = :dash ORDER BY created_at ASC"
        ),
        {"dash": source_id},
    )
    id_map: dict[str, str] = {}
    for w in widgets_result:
        new_widget = (
            await session.execute(
                text(
                    """
                    INSERT INTO widgets
                      (org_id, dashboard_id, dataset_id, kind, title, config_json)
                    VALUES
                      (:org, :dash, :ds, :kind, :title, CAST(:config AS jsonb))
                    RETURNING id
                    """
                ),
                {
                    "org": org_id,
                    "dash": new_dash.id,
                    "ds": dataset_id,
                    "kind": w.kind,
                    "title": w.title,
                    "config": json.dumps(dict(w.config_json or {})),
                },
            )
        ).one()
        id_map[str(w.id)] = str(new_widget.id)

    # Layout items reference widgets either by UUID (after a user has dragged
    # or resized) or by positional string like "0"/"1" (autodash output).
    # Positional indices still resolve correctly because we copy widgets in
    # creation order; only the UUID references need rewriting.
    new_layout: list[dict[str, Any]] = []
    for item in (src.layout_json or []):
        cloned = dict(item)
        i_val = cloned.get("i")
        if isinstance(i_val, str) and i_val in id_map:
            cloned["i"] = id_map[i_val]
        wid_val = cloned.get("widget_id")
        if isinstance(wid_val, str) and wid_val in id_map:
            cloned["widget_id"] = id_map[wid_val]
        new_layout.append(cloned)
    await session.execute(
        text(
            "UPDATE dashboards SET layout_json = CAST(:layout AS jsonb) "
            "WHERE id = :id"
        ),
        {"layout": json.dumps(new_layout), "id": new_dash.id},
    )
    return new_dash


@router.post("/dashboards", status_code=201, response_model=DashboardSummary)
async def create_dashboard(
    body: DashboardCreate,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
    plan: Plan = Depends(current_plan),
) -> DashboardSummary:
    ds = (
        await session.execute(
            text("SELECT id, name FROM datasets WHERE id = :id"),
            {"id": body.dataset_id},
        )
    ).first()
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset_not_found")

    count = (
        await session.execute(
            text(
                "SELECT COUNT(*)::int AS n FROM dashboards "
                "WHERE dataset_id = :ds"
            ),
            {"ds": body.dataset_id},
        )
    ).one()
    if count.n >= plan.max_dashboards_per_dataset:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "dashboard_limit_reached",
                "message": (
                    f"Plan {plan.name} allows up to "
                    f"{plan.max_dashboards_per_dataset} dashboards per dataset."
                ),
                "upgrade_hint": "Upgrade for more dashboards per dataset.",
            },
        )

    if body.mode == "duplicate" and body.source_dashboard_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "source_dashboard_required"
        )

    name = (body.name or "").strip() or await _default_dashboard_name(
        session,
        body.dataset_id,
        body.mode,
        body.source_dashboard_id,
        ds.name,
    )

    if body.mode == "blank":
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO dashboards
                      (org_id, dataset_id, name, kind, layout_json, overview)
                    VALUES
                      (:org, :ds, :name, 'manual', '[]'::jsonb, NULL)
                    RETURNING id, dataset_id, name, kind, created_at
                    """
                ),
                {
                    "org": p.org_id,
                    "ds": body.dataset_id,
                    "name": name,
                },
            )
        ).one()
    else:
        assert body.source_dashboard_id is not None  # guarded above
        row = await _duplicate_dashboard(
            session,
            p.org_id,
            body.source_dashboard_id,
            body.dataset_id,
            name,
        )

    return DashboardSummary(
        id=str(row.id),
        dataset_id=str(row.dataset_id),
        name=row.name,
        kind=row.kind,
        created_at=row.created_at.isoformat(),
    )


@router.get("/dashboards/{dashboard_id}", response_model=DashboardDetail)
async def get_dashboard(
    dashboard_id: uuid.UUID,
    session: AsyncSession = Depends(tenant_session),
) -> DashboardDetail:
    d = (
        await session.execute(
            text(
                "SELECT id, dataset_id, name, kind, layout_json, overview, "
                "created_at FROM dashboards WHERE id = :id"
            ),
            {"id": dashboard_id},
        )
    ).first()
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")

    widgets_result = await session.execute(
        text(
            "SELECT id, kind, title, config_json FROM widgets "
            "WHERE dashboard_id = :id ORDER BY created_at ASC"
        ),
        {"id": dashboard_id},
    )
    widgets = [
        WidgetOut(
            id=str(w.id),
            kind=w.kind,
            title=w.title,
            config=w.config_json,
        )
        for w in widgets_result
    ]

    return DashboardDetail(
        id=str(d.id),
        dataset_id=str(d.dataset_id),
        name=d.name,
        kind=d.kind,
        created_at=d.created_at.isoformat(),
        layout=d.layout_json or [],
        overview=d.overview,
        widgets=widgets,
    )


@router.get(
    "/dashboards/{dashboard_id}/delete-preview",
    response_model=DashboardDeletePreview,
)
async def dashboard_delete_preview(
    dashboard_id: uuid.UUID,
    session: AsyncSession = Depends(tenant_session),
) -> DashboardDeletePreview:
    row = (
        await session.execute(
            text(
                """
                SELECT d.id, d.name,
                  (SELECT COUNT(*)::int FROM widgets WHERE dashboard_id = d.id) AS widgets,
                  (SELECT COUNT(*)::int FROM chat_sessions
                     WHERE dashboard_id = d.id) AS chat_sessions,
                  (SELECT COUNT(*)::int FROM dashboard_shares
                     WHERE dashboard_id = d.id AND revoked_at IS NULL)
                     AS share_links_active
                FROM dashboards d WHERE d.id = :id
                """
            ),
            {"id": dashboard_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")
    return DashboardDeletePreview(
        dashboard_id=str(row.id),
        name=row.name,
        widgets=row.widgets,
        chat_sessions=row.chat_sessions,
        share_links_active=row.share_links_active,
    )


@router.delete("/dashboards/{dashboard_id}", status_code=204)
async def delete_dashboard(
    dashboard_id: uuid.UUID,
    session: AsyncSession = Depends(tenant_session),
) -> None:
    """Delete a dashboard; cascades through widgets, shares, chat sessions/messages."""
    widget_rows = await session.execute(
        text("SELECT id FROM widgets WHERE dashboard_id = :id"),
        {"id": dashboard_id},
    )
    widget_ids = [r.id for r in widget_rows]

    res = await session.execute(
        text("DELETE FROM dashboards WHERE id = :id"),
        {"id": dashboard_id},
    )
    if res.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")
    await session.commit()

    for wid in widget_ids:
        try:
            await cache.bust_widget(wid)
        except Exception:
            logger.exception("widget cache bust failed for %s", wid)


class ShareBody(BaseModel):
    ttl_hours: int | None = Field(default=None, ge=1, le=24 * 365)
    # When set, the link is intended for one recipient — the web layer
    # also sends them an email. Persisted purely for display in the modal;
    # nothing on the API side checks the viewer's identity against it.
    recipient_email: str | None = Field(default=None, max_length=320)


class ShareRow(BaseModel):
    id: str
    token: str
    recipient_email: str | None
    created_at: str
    expires_at: str | None
    revoked_at: str | None


@router.post("/dashboards/{dashboard_id}/share", response_model=ShareRow, status_code=201)
async def share_dashboard(
    dashboard_id: uuid.UUID,
    body: ShareBody,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> ShareRow:
    row = (
        await session.execute(
            text("SELECT id FROM dashboards WHERE id = :id"),
            {"id": dashboard_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")

    share_id = uuid.uuid4()
    token = mint_share_token(
        str(dashboard_id),
        p.org_id,
        ttl_hours=body.ttl_hours,
        jti=str(share_id),
    )
    expires_sql = (
        "NOW() + (:ttl || ' hours')::interval" if body.ttl_hours is not None else "NULL"
    )
    params: dict[str, Any] = {
        "id": share_id,
        "dashboard_id": dashboard_id,
        "token": token,
        "recipient_email": body.recipient_email,
        "user_id": p.user_id,
    }
    if body.ttl_hours is not None:
        params["ttl"] = str(body.ttl_hours)

    inserted = (
        await session.execute(
            text(
                f"""
                INSERT INTO dashboard_shares (
                    id, org_id, dashboard_id, token, recipient_email,
                    created_by_user_id, expires_at
                )
                VALUES (
                    :id,
                    current_setting('app.org_id', true),
                    :dashboard_id,
                    :token,
                    :recipient_email,
                    :user_id,
                    {expires_sql}
                )
                RETURNING id, token, recipient_email, created_at, expires_at, revoked_at
                """
            ),
            params,
        )
    ).first()
    assert inserted is not None  # the INSERT cannot return zero rows

    return ShareRow(
        id=str(inserted.id),
        token=inserted.token,
        recipient_email=inserted.recipient_email,
        created_at=inserted.created_at.isoformat(),
        expires_at=inserted.expires_at.isoformat() if inserted.expires_at else None,
        revoked_at=inserted.revoked_at.isoformat() if inserted.revoked_at else None,
    )


@router.get("/dashboards/{dashboard_id}/shares", response_model=list[ShareRow])
async def list_dashboard_shares(
    dashboard_id: uuid.UUID,
    session: AsyncSession = Depends(tenant_session),
) -> list[ShareRow]:
    result = await session.execute(
        text(
            "SELECT id, token, recipient_email, created_at, expires_at, revoked_at "
            "FROM dashboard_shares WHERE dashboard_id = :id "
            "ORDER BY created_at DESC"
        ),
        {"id": dashboard_id},
    )
    return [
        ShareRow(
            id=str(r.id),
            token=r.token,
            recipient_email=r.recipient_email,
            created_at=r.created_at.isoformat(),
            expires_at=r.expires_at.isoformat() if r.expires_at else None,
            revoked_at=r.revoked_at.isoformat() if r.revoked_at else None,
        )
        for r in result
    ]


@router.delete("/dashboards/{dashboard_id}/shares/{share_id}", status_code=204)
async def revoke_dashboard_share(
    dashboard_id: uuid.UUID,
    share_id: uuid.UUID,
    session: AsyncSession = Depends(tenant_session),
) -> None:
    res = await session.execute(
        text(
            "UPDATE dashboard_shares SET revoked_at = NOW() "
            "WHERE id = :id AND dashboard_id = :dash AND revoked_at IS NULL"
        ),
        {"id": share_id, "dash": dashboard_id},
    )
    if res.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "share_not_found")


@router.patch("/dashboards/{dashboard_id}", status_code=204)
async def update_layout(
    dashboard_id: uuid.UUID,
    body: LayoutPatch,
    session: AsyncSession = Depends(tenant_session),
) -> None:
    res = await session.execute(
        text(
            "UPDATE dashboards SET layout_json = CAST(:layout AS jsonb), "
            "customized = true, updated_at = NOW() WHERE id = :id"
        ),
        {"layout": json.dumps(body.layout), "id": dashboard_id},
    )
    if res.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")


async def _dataset_columns(
    session: AsyncSession, dataset_id: uuid.UUID
) -> list[dict[str, Any]]:
    res = await session.execute(
        text(
            "SELECT name, kind, dtype FROM dataset_columns "
            "WHERE dataset_id = :id ORDER BY position"
        ),
        {"id": dataset_id},
    )
    return [{"name": r.name, "kind": r.kind, "dtype": r.dtype} for r in res]


async def _load_dashboard_dataset(
    session: AsyncSession, dashboard_id: uuid.UUID
) -> uuid.UUID:
    row = (
        await session.execute(
            text("SELECT dataset_id FROM dashboards WHERE id = :id"),
            {"id": dashboard_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")
    return row.dataset_id


@router.post("/widgets/preview")
async def preview_widget(
    body: WidgetSpec,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> dict[str, Any]:
    dataset_id = await _load_dashboard_dataset(session, body.dashboard_id)
    columns = await _dataset_columns(session, dataset_id)
    try:
        config = build_widget_config(
            dataset_id,
            columns,
            kind=body.kind,
            title=body.title,
            x=body.x,
            y=body.y,
            aggregate=body.aggregate,
            label=body.label,
            value=body.value,
            time_bucket=body.time_bucket,
            limit=body.limit or 25,
        )
    except BuilderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad_config: {exc}") from exc

    sql = config["sql"]
    try:
        with open_org_connection(p.org_id) as conn:
            rows = run_query(conn, sql, limit=200)
    except UnsafeSQLError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unsafe_sql: {exc}") from exc

    return {"kind": body.kind, "config": config, "rows": rows}


@router.post("/widgets", status_code=201, response_model=WidgetOut)
async def create_widget(
    body: WidgetSpec,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
    plan: Plan = Depends(current_plan),
) -> WidgetOut:
    count = (
        await session.execute(
            text(
                "SELECT COUNT(*)::int AS n FROM widgets WHERE dashboard_id = :d"
            ),
            {"d": body.dashboard_id},
        )
    ).one()
    if count.n >= plan.max_widgets_per_dashboard:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "plan_limit",
                "message": (
                    f"Plan {plan.name} allows up to "
                    f"{plan.max_widgets_per_dashboard} widgets per dashboard."
                ),
            },
        )
    dataset_id = await _load_dashboard_dataset(session, body.dashboard_id)
    columns = await _dataset_columns(session, dataset_id)
    try:
        config = build_widget_config(
            dataset_id,
            columns,
            kind=body.kind,
            title=body.title,
            x=body.x,
            y=body.y,
            aggregate=body.aggregate,
            label=body.label,
            value=body.value,
            time_bucket=body.time_bucket,
            limit=body.limit or 25,
        )
    except BuilderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad_config: {exc}") from exc

    row = (
        await session.execute(
            text(
                """
                INSERT INTO widgets
                  (org_id, dashboard_id, dataset_id, kind, title, config_json)
                VALUES
                  (:org, :dash, :ds, :kind, :title, CAST(:config AS jsonb))
                RETURNING id, kind, title, config_json
                """
            ),
            {
                "org": p.org_id,
                "dash": body.dashboard_id,
                "ds": dataset_id,
                "kind": body.kind,
                "title": body.title,
                "config": json.dumps(config),
            },
        )
    ).one()
    await session.execute(
        text("UPDATE dashboards SET customized = true WHERE id = :d"),
        {"d": body.dashboard_id},
    )
    return WidgetOut(
        id=str(row.id), kind=row.kind, title=row.title, config=row.config_json
    )


@router.patch("/widgets/{widget_id}", response_model=WidgetOut)
async def update_widget(
    widget_id: uuid.UUID,
    body: WidgetUpdate,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> WidgetOut:
    existing = (
        await session.execute(
            text(
                "SELECT id, dashboard_id, dataset_id, kind, title, config_json "
                "FROM widgets WHERE id = :id"
            ),
            {"id": widget_id},
        )
    ).first()
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "widget_not_found")
    if existing.kind == "overview":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "overview_not_editable")

    cfg = dict(existing.config_json or {})
    kind = body.kind or existing.kind
    title = body.title or existing.title

    columns = await _dataset_columns(session, existing.dataset_id)
    try:
        rebuilt = build_widget_config(
            existing.dataset_id,
            columns,
            kind=kind,
            title=title,
            x=body.x if body.x is not None else cfg.get("x"),
            y=body.y if body.y is not None else cfg.get("y"),
            aggregate=body.aggregate if body.aggregate is not None else cfg.get("aggregate"),
            label=body.label if body.label is not None else cfg.get("label"),
            value=body.value if body.value is not None else cfg.get("value"),
            time_bucket=body.time_bucket
            if body.time_bucket is not None
            else cfg.get("time_bucket"),
            limit=body.limit if body.limit is not None else cfg.get("limit") or 25,
        )
    except BuilderError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad_config: {exc}") from exc

    updated = (
        await session.execute(
            text(
                """
                UPDATE widgets SET
                  kind = :kind, title = :title,
                  config_json = CAST(:config AS jsonb),
                  updated_at = NOW()
                WHERE id = :id
                RETURNING id, kind, title, config_json
                """
            ),
            {
                "kind": kind,
                "title": title,
                "config": json.dumps(rebuilt),
                "id": widget_id,
            },
        )
    ).one()
    await session.execute(
        text("UPDATE dashboards SET customized = true WHERE id = :d"),
        {"d": existing.dashboard_id},
    )
    await cache.bust_widget(widget_id)
    return WidgetOut(
        id=str(updated.id),
        kind=updated.kind,
        title=updated.title,
        config=updated.config_json,
    )


@router.delete("/widgets/{widget_id}", status_code=204)
async def delete_widget(
    widget_id: uuid.UUID,
    session: AsyncSession = Depends(tenant_session),
) -> None:
    res = await session.execute(
        text("DELETE FROM widgets WHERE id = :id RETURNING dashboard_id"),
        {"id": widget_id},
    )
    deleted = res.first()
    if deleted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "widget_not_found")
    await session.execute(
        text("UPDATE dashboards SET customized = true WHERE id = :d"),
        {"d": deleted.dashboard_id},
    )
    await cache.bust_widget(widget_id)


@router.post("/widgets/{widget_id}/data")
async def widget_data(
    widget_id: uuid.UUID,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> dict[str, Any]:
    row = (
        await session.execute(
            text(
                "SELECT w.id, w.kind, w.config_json, w.dataset_id, d.status, "
                "d.version FROM widgets w JOIN datasets d ON d.id = w.dataset_id "
                "WHERE w.id = :id"
            ),
            {"id": widget_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "widget_not_found")
    if row.status != "ready":
        return {"kind": row.kind, "status": row.status, "rows": []}

    config = row.config_json or {}

    if row.kind == "overview":
        return {"kind": "overview", "rows": [], "config": config}

    sql = config.get("sql")
    if not sql:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "widget_missing_sql")

    # Cache key folds the dataset version *and* the widget's per-mutation rev,
    # so any widget edit or dataset re-ingest auto-expires the cached payload.
    rev = await cache.widget_revision(widget_id)
    cache_version = row.version * 10_000 + rev
    cached = await cache.get_widget_data(widget_id, cache_version)
    if cached is not None:
        return cached

    try:
        with open_org_connection(p.org_id) as conn:
            rows = run_query(conn, sql, limit=1000)
    except UnsafeSQLError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unsafe_sql: {exc}") from exc

    payload = {
        "kind": row.kind,
        "status": row.status,
        "view": view_for_dataset(row.dataset_id),
        "rows": rows,
        "config": config,
    }
    await cache.set_widget_data(widget_id, cache_version, payload)
    return payload


@router.get("/widgets/{widget_id}/data.csv")
async def widget_csv(
    widget_id: uuid.UUID,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> StreamingResponse:
    row = (
        await session.execute(
            text(
                "SELECT w.id, w.kind, w.title, w.config_json, w.dataset_id, "
                "d.status FROM widgets w JOIN datasets d ON d.id = w.dataset_id "
                "WHERE w.id = :id"
            ),
            {"id": widget_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "widget_not_found")
    if row.status != "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "dataset_not_ready")
    if row.kind == "overview":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "overview_has_no_data")

    config = row.config_json or {}
    sql = config.get("sql")
    if not sql:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "widget_missing_sql")

    try:
        with open_org_connection(p.org_id) as conn:
            rows = run_query(conn, sql, limit=10_000)
    except UnsafeSQLError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unsafe_sql: {exc}") from exc

    buf = io.StringIO()
    writer = csv.writer(buf)
    headers = list(rows[0].keys()) if rows else []
    if headers:
        writer.writerow(headers)
        for r in rows:
            writer.writerow([r.get(h, "") for h in headers])

    safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in row.title)[:60] or "widget"
    body = buf.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([body]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_title}.csv"',
            "Cache-Control": "no-store",
        },
    )
