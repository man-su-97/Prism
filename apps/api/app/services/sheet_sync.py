"""Arq job + cron that keeps Sheet-backed datasets fresh.

Differences from the upload-driven ingest job (services/ingest.py):
- pulls rows directly from Google Sheets instead of MinIO
- preserves the existing dashboard/widgets (no auto-dash on resync)
- bumps datasets.version so cached widget payloads expire
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import sqlalchemy as sa
from sqlalchemy import text

from app.config import get_settings
from app.services import cache
from app.services.google_sheets import (
    GoogleApiError,
    GoogleAuthError,
    fetch_worksheet_as_dataframe,
    get_user_credentials,
)
from app.services.plans import get_plan
from app.services.profile import ColumnProfile, profile_dataframe

logger = logging.getLogger(__name__)
settings = get_settings()

PARQUET_ROOT = Path(os.getenv("PARQUET_ROOT", "/data/parquet"))


def _parquet_path(org_id: str, dataset_id: uuid.UUID) -> Path:
    return PARQUET_ROOT / org_id / f"{dataset_id}.parquet"


def _write_parquet(df: pd.DataFrame, target: Path) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(target, index=False, engine="pyarrow", compression="snappy")
    return target.stat().st_size


def _persist_columns(
    conn: sa.engine.Connection,
    org_id: str,
    dataset_id: uuid.UUID,
    profiles: list[ColumnProfile],
) -> None:
    conn.execute(
        text("DELETE FROM dataset_columns WHERE dataset_id = :id"),
        {"id": dataset_id},
    )
    for p in profiles:
        conn.execute(
            text(
                """
                INSERT INTO dataset_columns
                  (org_id, dataset_id, name, position, kind, dtype, nullable,
                   null_count, distinct_count, min_value, max_value, sample, stats)
                VALUES
                  (:org_id, :dataset_id, :name, :position, :kind, :dtype, :nullable,
                   :null_count, :distinct_count, :min_value, :max_value,
                   CAST(:sample AS jsonb), CAST(:stats AS jsonb))
                """
            ),
            {
                "org_id": org_id,
                "dataset_id": dataset_id,
                "name": p.name,
                "position": p.position,
                "kind": p.kind,
                "dtype": p.dtype,
                "nullable": p.nullable,
                "null_count": p.null_count,
                "distinct_count": p.distinct_count,
                "min_value": p.min_value,
                "max_value": p.max_value,
                "sample": json.dumps(p.sample),
                "stats": json.dumps(p.stats),
            },
        )


def _list_widget_ids(conn: sa.engine.Connection, dataset_id: uuid.UUID) -> list[uuid.UUID]:
    res = conn.execute(
        text("SELECT id FROM widgets WHERE dataset_id = :id"),
        {"id": dataset_id},
    )
    return [r.id for r in res]


def _sync_engine() -> sa.Engine:
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg")
    return sa.create_engine(sync_url, pool_pre_ping=True, future=True)


def _bootstrap_engine() -> sa.Engine:
    # The unprivileged app role (strata_app) is NOBYPASSRLS and FORCE RLS is
    # on, so the very first SELECT — which has to discover org_id — would
    # otherwise return zero rows. Use the superuser url for that lookup
    # only; everything afterwards runs back through _sync_engine() with
    # app.org_id set, so RLS still scopes writes.
    raw = os.getenv("MIGRATION_DATABASE_URL") or settings.database_url
    sync_url = raw.replace("+asyncpg", "+psycopg")
    return sa.create_engine(sync_url, pool_pre_ping=True, future=True)


async def sync_sheet_dataset(ctx: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    """Arq job entry. Re-fetches the sheet, rewrites parquet, bumps version."""
    dsid = uuid.UUID(dataset_id)

    bootstrap = _bootstrap_engine()
    try:
        with bootstrap.begin() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT id, org_id, connected_by_user_id AS user_id,
                           sheet_spreadsheet_id, sheet_worksheet_title, status, version
                    FROM datasets
                    WHERE id = :id AND source_kind = 'sheet'
                    """
                ),
                {"id": dsid},
            ).first()
            sub_row = (
                conn.execute(
                    text("SELECT plan, status FROM subscriptions WHERE org_id = :org"),
                    {"org": row.org_id},
                ).first()
                if row is not None
                else None
            )
    finally:
        bootstrap.dispose()

    if row is None:
        return {"status": "skipped", "reason": "not_a_sheet"}
    if not row.sheet_spreadsheet_id or not row.sheet_worksheet_title:
        return {"status": "skipped", "reason": "missing_sheet_metadata"}
    if not row.user_id:
        return {"status": "skipped", "reason": "no_connected_user"}
    org_id = row.org_id
    user_id = row.user_id
    spreadsheet_id = row.sheet_spreadsheet_id
    worksheet_title = row.sheet_worksheet_title

    _DEGRADED = ("canceled", "incomplete_expired", "unpaid")
    _plan_name = (
        sub_row.plan
        if sub_row is not None and sub_row.status not in _DEGRADED
        else "free"
    )
    org_plan = get_plan(_plan_name)

    engine = _sync_engine()
    with engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
        conn.execute(
            text(
                "UPDATE datasets SET status = 'ingesting', updated_at = NOW() "
                "WHERE id = :id"
            ),
            {"id": dsid},
        )

    try:
        creds = get_user_credentials(engine, user_id)
        df = fetch_worksheet_as_dataframe(creds, spreadsheet_id, worksheet_title)
        if df.empty:
            raise RuntimeError("sheet returned 0 rows (including header)")

        row_count = len(df)

        if row_count > org_plan.row_cap:
            with engine.begin() as conn:
                conn.execute(
                    text("SELECT set_config('app.org_id', :org, false)"),
                    {"org": org_id},
                )
                conn.execute(
                    text(
                        "UPDATE datasets SET status='error', error=:err, "
                        "sheet_last_sync_at=NOW(), updated_at=NOW() WHERE id=:id"
                    ),
                    {
                        "err": (
                            f"row_cap_exceeded: Sheet contains {row_count:,} rows but your "
                            f"{org_plan.name.title()} plan allows up to "
                            f"{org_plan.row_cap:,} rows per dataset. "
                            "Upgrade your plan and click Refresh to sync this sheet."
                        ),
                        "id": dsid,
                    },
                )
            logger.warning(
                "row_cap_exceeded: sheet_dataset=%s org=%s rows=%d cap=%d",
                dataset_id, org_id, row_count, org_plan.row_cap,
            )
            return {"status": "error", "error": "row_cap_exceeded"}

        profiles = profile_dataframe(df)

        parquet_target = _parquet_path(org_id, dsid)
        size_bytes = _write_parquet(df, parquet_target)

        with engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.org_id', :org, false)"),
                {"org": org_id},
            )
            _persist_columns(conn, org_id, dsid, profiles)
            conn.execute(
                text(
                    """
                    UPDATE datasets SET
                      status = 'ready',
                      error = NULL,
                      row_count = :row_count,
                      parquet_path = :parquet,
                      size_bytes = :size,
                      version = version + 1,
                      sheet_last_sync_at = NOW(),
                      updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {
                    "row_count": row_count,
                    "parquet": str(parquet_target),
                    "size": size_bytes,
                    "id": dsid,
                },
            )
            widget_ids = _list_widget_ids(conn, dsid)

        # Cache-bust every widget bound to the dataset so the next render hits DuckDB.
        for wid in widget_ids:
            try:
                await cache.bust_widget(wid)
            except Exception:
                logger.exception("cache bust failed for widget %s", wid)

        return {
            "status": "ready",
            "row_count": row_count,
            "columns": len(profiles),
            "widgets_busted": len(widget_ids),
        }

    except (GoogleAuthError, GoogleApiError, Exception) as exc:
        logger.exception("sheet sync failed for %s", dataset_id)
        with engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.org_id', :org, false)"),
                {"org": org_id},
            )
            conn.execute(
                text(
                    "UPDATE datasets SET status = 'error', error = :err, "
                    "updated_at = NOW() WHERE id = :id"
                ),
                {"err": str(exc)[:500], "id": dsid},
            )
        return {"status": "error", "error": str(exc)}


# --- Cron entry ------------------------------------------------------------ #


async def enqueue_due_sheet_syncs(ctx: dict[str, Any]) -> dict[str, Any]:
    """Find sheet datasets whose `sheet_last_sync_at` is older than their
    `refresh_interval_minutes` and enqueue a sync for each.
    """
    pool = ctx.get("redis")
    if pool is None:
        return {"enqueued": 0, "reason": "no_redis"}

    engine = _sync_engine()
    threshold_window = datetime.now(UTC)

    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id
                FROM datasets
                WHERE source_kind = 'sheet'
                  AND status IN ('ready', 'error')
                  AND (error IS NULL OR error NOT LIKE 'row_cap_exceeded:%')
                  AND (
                    sheet_last_sync_at IS NULL
                    OR sheet_last_sync_at <
                       :now - (refresh_interval_minutes || ' minutes')::interval
                  )
                LIMIT 100
                """
            ),
            {"now": threshold_window},
        ).all()

    enqueued = 0
    for r in rows:
        try:
            await pool.enqueue_job("sync_sheet_dataset", str(r.id))
            enqueued += 1
        except Exception:
            logger.exception("failed to enqueue sync for %s", r.id)
        # Yield so Arq doesn't see one huge synchronous burst.
        await asyncio.sleep(0)

    return {"enqueued": enqueued}
