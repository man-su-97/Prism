"""Arq job that pulls a raw upload from MinIO, profiles it, and writes parquet.

Status transitions: pending → ingesting → ready | error.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
import sqlalchemy as sa
from sqlalchemy import text

from app.config import get_settings
from app.services import cache
from app.services.autodash import build_plan
from app.services.header_ai import HeaderPlan, propose_header
from app.services.minio_client import fget_object
from app.services.overview import generate_overview
from app.services.plans import get_plan
from app.services.profile import (
    ColumnProfile,
    detect_header_offset,
    normalize_for_parquet,
    profile_dataframe,
    should_escalate,
)

logger = logging.getLogger(__name__)
settings = get_settings()

PARQUET_ROOT = Path(os.getenv("PARQUET_ROOT", "/data/parquet"))
CSV_CHUNK_ROWS = 50_000
HEADER_SCAN_ROWS = 20


def _parquet_path(org_id: str, dataset_id: uuid.UUID) -> Path:
    return PARQUET_ROOT / org_id / f"{dataset_id}.parquet"


def _resolve_header(
    peek: pd.DataFrame, header_offset: int | None
) -> int:
    """Manual override wins; otherwise auto-detect from the peeked rows.

    Detection must never fail ingestion — any unexpected frame shape falls
    back to offset 0 (current behavior).
    """
    if header_offset is not None:
        return max(0, header_offset)
    try:
        return detect_header_offset(peek, max_scan=HEADER_SCAN_ROWS)
    except Exception:
        logger.exception("header detection failed; defaulting to row 0")
        return 0


def _resolve_header_plan(
    peek: pd.DataFrame,
    sheet_key: str,
    header_offset: int | None,
    existing_plan: dict[str, Any] | None,
) -> tuple[int | None, HeaderPlan | None, bool]:
    """Three-tier resolution on the peek.

    Returns (offset, plan, is_new_ai):
      - offset set, plan None  -> read with header=offset (manual or heuristic).
      - plan set, offset None   -> read header=None, slice+rename.
    `is_new_ai` is True only when the plan came fresh from the AI tier (the
    caller persists those). Never raises — every failure degrades to heuristic.
    """
    if header_offset is not None:  # 1. manual override
        return max(0, header_offset), None, False
    if existing_plan and sheet_key in existing_plan:  # 2. persisted plan
        entry = existing_plan[sheet_key]
        try:
            return None, HeaderPlan(int(entry["data_start_row"]), list(entry["columns"])), False
        except (KeyError, TypeError, ValueError):
            pass  # corrupt entry -> fall through to heuristic
    try:  # 3. heuristic
        h = detect_header_offset(peek, max_scan=HEADER_SCAN_ROWS)
    except Exception:
        h = 0
    if not should_escalate(peek, h):
        return h, None, False
    plan = propose_header(peek.values.tolist(), sheet_key)
    if plan is None:
        return h, None, False
    return None, plan, True


def _apply_plan(raw: pd.DataFrame, plan: HeaderPlan) -> pd.DataFrame | None:
    """Slice off preamble and assign the planned names. None on shape mismatch
    (e.g. a persisted plan against a changed file) -> caller falls back."""
    if plan.data_start_row >= len(raw):
        return None
    body = raw.iloc[plan.data_start_row:].reset_index(drop=True)
    if body.shape[1] != len(plan.columns):
        return None
    body.columns = plan.columns
    return body


def _read_to_frame(
    local_path: str,
    source_kind: str,
    worksheet_names: list[str] | None,
    header_offset: int | None = None,
    existing_plan: dict[str, Any] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    plan_out: dict[str, Any] = {}

    def _finish_sheet(
        local: str, reader: Any, sheet: Any, sheet_key: str
    ) -> pd.DataFrame:
        peek = reader(sheet, header=None, nrows=HEADER_SCAN_ROWS)
        offset, plan, is_new = _resolve_header_plan(
            peek, sheet_key, header_offset, existing_plan
        )
        if plan is not None:
            # AI/persisted plan: read the whole sheet (header=None) so we can
            # slice off preamble rows; for CSV this is an unchunked read, but it
            # only happens on low-confidence files (rare, typically small).
            raw = reader(sheet, header=None, nrows=None)
            applied = _apply_plan(raw, plan)
            if applied is not None:
                if is_new:
                    plan_out[sheet_key] = {
                        "data_start_row": plan.data_start_row,
                        "columns": plan.columns,
                    }
                return applied
            # plan didn't fit the data -> fall back to the heuristic offset.
            offset = _resolve_header(peek, None)
        return reader(sheet, header=offset, nrows=None)

    if source_kind == "csv":
        def csv_reader(_sheet: Any, header: Any, nrows: Any) -> pd.DataFrame:
            """Read the CSV. An int `header` means the real full read (chunked
            for memory); `header=None` is either the bounded peek (nrows set)
            or the AI-path full read (nrows=None, read whole file unchunked)."""
            if isinstance(header, int):  # full read, possibly chunked
                chunks = [
                    c
                    for c in pd.read_csv(
                        local_path,
                        header=header,
                        chunksize=CSV_CHUNK_ROWS,
                        low_memory=False,
                    )
                ]
                return pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
            return pd.read_csv(local_path, header=header, nrows=nrows, low_memory=False)

        df = _finish_sheet(local_path, csv_reader, None, "__file__")
        return df, plan_out

    if source_kind in ("xlsx", "xls"):
        engine = "openpyxl" if source_kind == "xlsx" else "xlrd"

        def excel_reader(sheet: Any, header: Any, nrows: Any) -> pd.DataFrame:
            return pd.read_excel(
                local_path, sheet_name=sheet, header=header, nrows=nrows, engine=engine
            )

        if not worksheet_names:
            df = _finish_sheet(local_path, excel_reader, 0, "__file__")
            return df, plan_out
        try:
            tagged: list[pd.DataFrame] = []
            for name in worksheet_names:
                sheet_df = _finish_sheet(local_path, excel_reader, name, name)
                # The synthetic _sheet tag must not collide with a real/AI-named
                # column; rename any pre-existing one (columns are already unique).
                if "_sheet" in sheet_df.columns:
                    sheet_df.columns = [
                        "_sheet (col)" if c == "_sheet" else c for c in sheet_df.columns
                    ]
                sheet_df.insert(0, "_sheet", name)
                tagged.append(sheet_df)
        except ValueError as e:
            raise ValueError("worksheet_not_found") from e
        if len(tagged) == 1:
            return tagged[0], plan_out
        col_sets = [set(df.columns) - {"_sheet"} for df in tagged]
        if not set.intersection(*col_sets):
            raise ValueError("no_common_columns")
        return pd.concat(tagged, ignore_index=True, sort=False), plan_out

    raise ValueError(f"unsupported source_kind: {source_kind}")


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


def _build_starter_dashboard(
    sync_engine: sa.Engine,
    org_id: str,
    dataset_id: uuid.UUID,
    dataset_name: str,
    row_count: int,
    columns: list[dict[str, Any]],
) -> str:
    """Create dashboards + widgets rows for a freshly-ingested dataset."""
    plan = build_plan(dataset_id, dataset_name, columns)
    overview = generate_overview(dataset_name, row_count, columns)

    with sync_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})

        dashboard_row = conn.execute(
            text(
                """
                INSERT INTO dashboards
                  (org_id, dataset_id, name, kind, layout_json, overview)
                VALUES
                  (:org, :ds, :name, 'auto', CAST(:layout AS jsonb), :overview)
                RETURNING id
                """
            ),
            {
                "org": org_id,
                "ds": dataset_id,
                "name": plan.name,
                "layout": json.dumps(plan.layout),
                "overview": overview,
            },
        ).one()
        dashboard_id = dashboard_row.id

        for w in plan.widgets:
            conn.execute(
                text(
                    """
                    INSERT INTO widgets
                      (org_id, dashboard_id, dataset_id, kind, title, config_json)
                    VALUES
                      (:org, :dash, :ds, :kind, :title, CAST(:config AS jsonb))
                    """
                ),
                {
                    "org": org_id,
                    "dash": dashboard_id,
                    "ds": dataset_id,
                    "kind": w.kind,
                    "title": w.title,
                    "config": json.dumps(w.config),
                },
            )

    return str(dashboard_id)


def _prepare_starter_dashboard(
    sync_engine: sa.Engine,
    org_id: str,
    dataset_id: uuid.UUID,
) -> tuple[bool, list[uuid.UUID]]:
    """Decide whether ingest should (re)build the starter dashboard.

    Returns (should_build, orphaned_widget_ids). Build when the dataset has no
    dashboards (first ingest), or regenerate when its only dashboard is the
    pristine auto one (kind='auto' and not customized) — deleting it first and
    returning its widget ids so the caller can bust their cache. Otherwise
    leave the user's dashboards intact and don't build.
    """
    with sync_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
        rows = conn.execute(
            text(
                "SELECT id, kind, customized FROM dashboards WHERE dataset_id = :ds"
            ),
            {"ds": dataset_id},
        ).all()
        if not rows:
            return True, []
        if len(rows) == 1 and rows[0].kind == "auto" and not rows[0].customized:
            dash_id = rows[0].id
            widget_ids = [
                r.id
                for r in conn.execute(
                    text("SELECT id FROM widgets WHERE dashboard_id = :d"),
                    {"d": dash_id},
                )
            ]
            conn.execute(
                text("DELETE FROM dashboards WHERE id = :d"), {"d": dash_id}
            )
            return True, widget_ids
        return False, []


async def ingest_dataset(ctx: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    """Arq job entry point.

    Runs the full pipeline under the same SQL session as the row owner so RLS
    works without a JWT (the worker sets app.org_id from the row itself).
    """
    dsid = uuid.UUID(dataset_id)
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg")

    # FORCE RLS on the unprivileged app role would silently filter this
    # bootstrap read to zero rows (app.org_id is not set yet — we're
    # discovering it). Read via the superuser url first, then continue on
    # the regular RLS-enforced engine with app.org_id set.
    bootstrap_url = (
        os.getenv("MIGRATION_DATABASE_URL") or settings.database_url
    ).replace("+asyncpg", "+psycopg")
    bootstrap_engine = sa.create_engine(bootstrap_url, pool_pre_ping=True, future=True)
    try:
        with bootstrap_engine.begin() as conn:
            row = conn.execute(
                text(
                    "SELECT org_id, source_kind, object_key, worksheet_names, "
                    "header_offset, header_plan "
                    "FROM datasets "
                    "WHERE id = :id AND status IN ('pending','ingesting','error')"
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
        bootstrap_engine.dispose()

    if row is None:
        logger.warning("ingest_dataset: nothing to do for %s", dataset_id)
        return {"status": "skipped"}

    org_id = row.org_id
    source_kind = row.source_kind
    object_key = row.object_key
    worksheet_names: list[str] | None = row.worksheet_names
    header_offset: int | None = row.header_offset
    existing_plan: dict[str, Any] | None = row.header_plan

    # Resolve the org's effective plan (fall back to free on missing/bad status).
    _DEGRADED = ("canceled", "incomplete_expired", "unpaid")
    _plan_name = (
        sub_row.plan
        if sub_row is not None and sub_row.status not in _DEGRADED
        else "free"
    )
    org_plan = get_plan(_plan_name)

    sync_engine = sa.create_engine(sync_url, pool_pre_ping=True, future=True)

    with sync_engine.begin() as conn:
        # Bind RLS context for any subsequent writes the job performs.
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
        conn.execute(
            text("UPDATE datasets SET status = 'ingesting', updated_at = NOW() WHERE id = :id"),
            {"id": dsid},
        )

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            suffix = {"xlsx": ".xlsx", "xls": ".xls"}.get(source_kind, ".csv")
            local = Path(tmpdir) / f"src{suffix}"
            fget_object(object_key, str(local))

            df, new_plan = _read_to_frame(
                str(local), source_kind, worksheet_names, header_offset, existing_plan
            )
            # Messy spreadsheets produce mixed-type object columns that pyarrow
            # can't write; normalize before profiling so dataset_columns matches
            # the parquet that DuckDB will actually read.
            df = normalize_for_parquet(df)
            profiles = profile_dataframe(df)
            row_count = len(df)

            # Enforce row cap before writing parquet — no wasted I/O on violation.
            if row_count > org_plan.row_cap:
                with sync_engine.begin() as conn:
                    conn.execute(
                        text("SELECT set_config('app.org_id', :org, false)"),
                        {"org": org_id},
                    )
                    conn.execute(
                        text(
                            "UPDATE datasets SET status='error', error=:err, "
                            "updated_at=NOW() WHERE id=:id"
                        ),
                        {
                            "err": (
                                f"File contains {row_count:,} rows but your "
                                f"{org_plan.name.title()} plan allows up to "
                                f"{org_plan.row_cap:,} rows per dataset. "
                                "Upgrade your plan to process larger files."
                            ),
                            "id": dsid,
                        },
                    )
                logger.warning(
                    "row_cap_exceeded: dataset=%s org=%s rows=%d cap=%d",
                    dataset_id, org_id, row_count, org_plan.row_cap,
                )
                return {"status": "error", "error": "row_cap_exceeded"}

            parquet_target = _parquet_path(org_id, dsid)
            size_bytes = _write_parquet(df, parquet_target)

        column_records = [p.to_record() for p in profiles]

        with sync_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
            _persist_columns(conn, org_id, dsid, profiles)
            conn.execute(
                text(
                    """
                    UPDATE datasets SET
                      status = 'ready',
                      version = version + 1,
                      error = NULL,
                      row_count = :row_count,
                      parquet_path = :parquet_path,
                      size_bytes = :size_bytes,
                      updated_at = NOW()
                    WHERE id = :id
                    RETURNING name
                    """
                ),
                {
                    "row_count": row_count,
                    "parquet_path": str(parquet_target),
                    "size_bytes": size_bytes,
                    "id": dsid,
                },
            )
            ds_name_row = conn.execute(
                text("SELECT name FROM datasets WHERE id = :id"),
                {"id": dsid},
            ).first()
            ds_name = ds_name_row.name if ds_name_row else str(dsid)

        if new_plan:
            merged = {**(existing_plan or {}), **new_plan}
            with sync_engine.begin() as conn:
                conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
                conn.execute(
                    text("UPDATE datasets SET header_plan = CAST(:plan AS jsonb) WHERE id = :id"),
                    {"plan": json.dumps(merged), "id": dsid},
                )

        # Best-effort: build the starter dashboard on first ingest, or
        # regenerate it on re-ingest when the user hasn't customized it.
        # Errors here don't fail ingestion — the dataset is still queryable.
        dashboard_id: str | None = None
        try:
            should_build, orphaned = _prepare_starter_dashboard(
                sync_engine, org_id, dsid
            )
            for wid in orphaned:
                try:
                    await cache.bust_widget(wid)
                except Exception:
                    logger.exception("widget cache bust failed for %s", wid)
            if should_build:
                dashboard_id = _build_starter_dashboard(
                    sync_engine, org_id, dsid, ds_name, row_count, column_records
                )
        except Exception:
            logger.exception("autodash failed for %s", dataset_id)

        return {
            "status": "ready",
            "row_count": row_count,
            "columns": len(profiles),
            "dashboard_id": dashboard_id,
        }

    except Exception as exc:
        logger.exception("ingest failed for %s", dataset_id)
        with sync_engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
            conn.execute(
                text(
                    "UPDATE datasets SET status = 'error', error = :err, "
                    "updated_at = NOW() WHERE id = :id"
                ),
                {"err": str(exc)[:500], "id": dsid},
            )
        return {"status": "error", "error": str(exc)}
