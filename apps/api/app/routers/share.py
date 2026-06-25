"""Public read-only share view for dashboards.

Routes here DO NOT require a JWT — the token in the URL is the bearer of
authority. Each handler verifies the token, sets `app.org_id` for RLS, and
restricts work to the dashboard the token names.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from app.db import SessionFactory
from app.services.duck import (
    UnsafeSQLError,
    open_org_connection,
    run_query,
    view_for_dataset,
)
from app.services.share import InvalidShareToken, verify

router = APIRouter(prefix="/api/share", tags=["share"])


class WidgetOut(BaseModel):
    id: str
    kind: str
    title: str
    config: dict[str, Any]


class SharedDashboard(BaseModel):
    dashboard_id: str
    dataset_id: str
    name: str
    kind: str
    layout: list[dict[str, Any]]
    overview: str | None
    widgets: list[WidgetOut]


async def _scoped(org_id: str):
    """Open a session with `app.org_id` set so RLS lets the dashboard through."""
    session = SessionFactory()
    await session.execute(
        text("SELECT set_config('app.org_id', :org, true)"),
        {"org": org_id},
    )
    return session


async def _reject_if_revoked(session, claims) -> None:
    """Look up the share by `jti` and 401 if it was revoked or deleted.

    Legacy tokens minted before migration 20260514_0001 have no `jti` and
    therefore no DB row — they keep working until expiry or secret rotation.
    """
    if not claims.jti:
        return
    row = (
        await session.execute(
            text(
                "SELECT revoked_at FROM dashboard_shares "
                "WHERE id = :id AND dashboard_id = :dash"
            ),
            {"id": claims.jti, "dash": claims.dashboard_id},
        )
    ).first()
    if row is None or row.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "share_revoked")


@router.get("/{token}", response_model=SharedDashboard)
async def view_share(token: str) -> SharedDashboard:
    try:
        claims = verify(token)
    except InvalidShareToken as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid_token: {exc}") from exc

    try:
        dashboard_uuid = uuid.UUID(claims.dashboard_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad_dashboard_id") from exc

    session = await _scoped(claims.org_id)
    try:
        await _reject_if_revoked(session, claims)
        dash_row = (
            await session.execute(
                text(
                    "SELECT id, dataset_id, name, kind, layout_json, overview "
                    "FROM dashboards WHERE id = :id"
                ),
                {"id": dashboard_uuid},
            )
        ).first()
        if dash_row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")

        widget_rows = await session.execute(
            text(
                "SELECT id, kind, title, config_json FROM widgets "
                "WHERE dashboard_id = :id ORDER BY created_at ASC"
            ),
            {"id": dashboard_uuid},
        )
        widgets = [
            WidgetOut(
                id=str(w.id),
                kind=w.kind,
                title=w.title,
                config=w.config_json,
            )
            for w in widget_rows
        ]

        return SharedDashboard(
            dashboard_id=str(dash_row.id),
            dataset_id=str(dash_row.dataset_id),
            name=dash_row.name,
            kind=dash_row.kind,
            layout=dash_row.layout_json or [],
            overview=dash_row.overview,
            widgets=widgets,
        )
    finally:
        await session.close()


@router.post("/{token}/widgets/{widget_id}/data")
async def share_widget_data(token: str, widget_id: uuid.UUID) -> dict[str, Any]:
    try:
        claims = verify(token)
    except InvalidShareToken as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid_token: {exc}") from exc

    try:
        dashboard_uuid = uuid.UUID(claims.dashboard_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad_dashboard_id") from exc

    session = await _scoped(claims.org_id)
    try:
        await _reject_if_revoked(session, claims)
        row = (
            await session.execute(
                text(
                    "SELECT w.id, w.kind, w.config_json, w.dataset_id, d.status "
                    "FROM widgets w "
                    "JOIN datasets d ON d.id = w.dataset_id "
                    "WHERE w.id = :id AND w.dashboard_id = :dash"
                ),
                {"id": widget_id, "dash": dashboard_uuid},
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
        try:
            with open_org_connection(claims.org_id) as conn:
                rows = run_query(conn, sql, limit=1000)
        except UnsafeSQLError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unsafe_sql: {exc}") from exc
        return {
            "kind": row.kind,
            "status": row.status,
            "view": view_for_dataset(row.dataset_id),
            "rows": rows,
            "config": config,
        }
    finally:
        await session.close()
