from __future__ import annotations

import uuid

import sqlalchemy as sa
from arq.connections import RedisSettings, create_pool
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.deps.auth import Principal, principal, tenant_session
from app.deps.limits import require_dataset_capacity
from app.services import rate_limit
from app.services.google_sheets import (
    GoogleApiError,
    GoogleAuthError,
    get_user_credentials,
    has_google_account,
    list_spreadsheets,
    list_worksheets,
)
from app.services.plans import Plan

router = APIRouter(prefix="/api/sheets", tags=["sheets"])
settings = get_settings()


class SpreadsheetSummary(BaseModel):
    id: str
    name: str
    modified_time: str | None = None


class WorksheetSummary(BaseModel):
    sheet_id: int
    title: str
    row_count: int | None = None
    column_count: int | None = None


class ConnectRequest(BaseModel):
    spreadsheet_id: str = Field(min_length=1)
    spreadsheet_name: str = Field(min_length=1, max_length=200)
    worksheet_title: str = Field(min_length=1, max_length=200)
    refresh_interval_minutes: int = Field(default=60, ge=5, le=24 * 60)
    name: str | None = Field(default=None, max_length=200)


class ConnectResponse(BaseModel):
    dataset_id: str
    status: str


def _sync_engine() -> sa.Engine:
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg")
    return sa.create_engine(sync_url, pool_pre_ping=True, future=True)


@router.get("/connected")
async def google_connected(p: Principal = Depends(principal)) -> dict[str, bool]:
    engine = _sync_engine()
    return {"connected": has_google_account(engine, p.user_id)}


@router.get("/spreadsheets", response_model=list[SpreadsheetSummary])
async def list_user_spreadsheets(
    q: str | None = None,
    p: Principal = Depends(principal),
) -> list[SpreadsheetSummary]:
    engine = _sync_engine()
    try:
        creds = get_user_credentials(engine, p.user_id)
        files = list_spreadsheets(creds, query=q)
    except GoogleAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"google_auth: {exc}") from exc
    except GoogleApiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"google_api: {exc}") from exc

    return [
        SpreadsheetSummary(
            id=f["id"],
            name=f.get("name", "Untitled"),
            modified_time=f.get("modifiedTime"),
        )
        for f in files
    ]


@router.get(
    "/spreadsheets/{spreadsheet_id}/worksheets",
    response_model=list[WorksheetSummary],
)
async def list_spreadsheet_worksheets(
    spreadsheet_id: str,
    p: Principal = Depends(principal),
) -> list[WorksheetSummary]:
    engine = _sync_engine()
    try:
        creds = get_user_credentials(engine, p.user_id)
        sheets = list_worksheets(creds, spreadsheet_id)
    except GoogleAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"google_auth: {exc}") from exc
    except GoogleApiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"google_api: {exc}") from exc

    return [
        WorksheetSummary(
            sheet_id=s["sheet_id"] or 0,
            title=s["title"],
            row_count=s.get("row_count"),
            column_count=s.get("column_count"),
        )
        for s in sheets
        if s.get("title")
    ]


@router.post("/connect", response_model=ConnectResponse, status_code=201)
async def connect_sheet(
    body: ConnectRequest,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
    plan: Plan = Depends(require_dataset_capacity),
) -> ConnectResponse:
    # Validate Google connection + worksheet existence using metadata only — no
    # full row download here. fetch_worksheet_as_dataframe would pull every row
    # (potentially millions) just to confirm the sheet is reachable.
    engine = _sync_engine()
    try:
        creds = get_user_credentials(engine, p.user_id)
        worksheets = list_worksheets(creds, body.spreadsheet_id)
    except GoogleAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"google_auth: {exc}") from exc
    except GoogleApiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"google_api: {exc}") from exc

    titles = {ws["title"] for ws in worksheets if ws.get("title")}
    if body.worksheet_title not in titles:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "worksheet_not_found",
        )

    override = body.name.strip() if body.name else ""
    name = override or f"{body.spreadsheet_name} · {body.worksheet_title}"

    insert = await session.execute(
        text(
            """
            INSERT INTO datasets
              (org_id, created_by_user_id, connected_by_user_id, name, source_kind,
               object_key, status, sheet_spreadsheet_id, sheet_worksheet_title,
               refresh_interval_minutes)
            VALUES
              (:org, :uid, :uid, :name, 'sheet', :key, 'pending',
               :sid, :wtitle, :interval)
            RETURNING id
            """
        ),
        {
            "org": p.org_id,
            "uid": p.user_id,
            "name": name,
            "key": f"sheet://{body.spreadsheet_id}/{body.worksheet_title}",
            "sid": body.spreadsheet_id,
            "wtitle": body.worksheet_title,
            "interval": body.refresh_interval_minutes,
        },
    )
    dataset_id = str(insert.one().id)
    await session.commit()

    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        await pool.enqueue_job("sync_sheet_dataset", dataset_id)
    finally:
        await pool.aclose()

    return ConnectResponse(dataset_id=dataset_id, status="pending")


@router.post("/{dataset_id}/refresh", response_model=ConnectResponse)
async def refresh_sheet(
    dataset_id: uuid.UUID,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> ConnectResponse:
    # 12 manual refreshes per hour per org prevents Google API quota exhaustion
    # and Arq queue flooding while still allowing responsive on-demand syncs.
    rl = await rate_limit.check(p.org_id, scope="sheet_refresh", limit=12)
    if not rl.allowed:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "sheet_refresh_rate_limited")

    row = (
        await session.execute(
            text(
                "SELECT id, source_kind FROM datasets WHERE id = :id"
            ),
            {"id": dataset_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset_not_found")
    if row.source_kind != "sheet":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not_a_sheet_dataset")

    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        await pool.enqueue_job("sync_sheet_dataset", str(dataset_id))
    finally:
        await pool.aclose()

    return ConnectResponse(dataset_id=str(dataset_id), status="ingesting")
