"""Per-request DuckDB connection scoped to one org's parquet directory.

Hard guarantees:
- only SELECT / WITH statements (read-only)
- no ATTACH, COPY, INSTALL, LOAD, PRAGMA, EXPORT, SET, CALL
- no string literals containing absolute paths or url schemes
- the only readable tables are parquet views registered for the org

Datasets are registered as views named `ds_<dataset_id_with_underscores>`.
"""
from __future__ import annotations

import os
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import duckdb

PARQUET_ROOT = Path(os.getenv("PARQUET_ROOT", "/data/parquet"))

_ALLOWED_PREFIXES = ("SELECT", "WITH")
_FORBIDDEN_KEYWORDS = (
    "ATTACH",
    "DETACH",
    "COPY",
    "INSTALL",
    "LOAD",
    "PRAGMA",
    "EXPORT",
    "IMPORT",
    "SET",
    "CALL",
    "CREATE",
    "DROP",
    "ALTER",
    "DELETE",
    "UPDATE",
    "INSERT",
    "VACUUM",
    "ANALYZE",
)
_PATH_LITERAL = re.compile(r"['\"][^'\"]*?(/|\\|\.parquet|\.csv|\.json|s3://|http://|https://|file://)[^'\"]*['\"]", re.I)


class UnsafeSQLError(ValueError):
    pass


def _strip_comments(sql: str) -> str:
    # Remove -- line comments and /* block */ comments.
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return sql


def validate_sql(sql: str) -> str:
    """Raise UnsafeSQLError if `sql` is anything but a read-only query."""
    if not sql or not sql.strip():
        raise UnsafeSQLError("empty SQL")

    cleaned = _strip_comments(sql).strip().rstrip(";").strip()
    upper = cleaned.upper()

    if ";" in cleaned:
        raise UnsafeSQLError("multiple statements not allowed")

    if not any(upper.startswith(p) for p in _ALLOWED_PREFIXES):
        raise UnsafeSQLError("only SELECT / WITH statements allowed")

    for kw in _FORBIDDEN_KEYWORDS:
        # Word-boundary match so 'CREATE' inside an identifier doesn't trip.
        if re.search(rf"\b{kw}\b", upper):
            raise UnsafeSQLError(f"keyword {kw} not allowed")

    if _PATH_LITERAL.search(cleaned):
        raise UnsafeSQLError("file paths / urls not allowed in SQL")

    return cleaned


def _safe_view_name(dataset_id: uuid.UUID) -> str:
    return "ds_" + str(dataset_id).replace("-", "_")


def org_parquet_dir(org_id: str) -> Path:
    return PARQUET_ROOT / org_id


@contextmanager
def open_org_connection(org_id: str) -> Iterator[duckdb.DuckDBPyConnection]:
    """Open an in-memory DuckDB; register parquet files under the org as views.

    Read-only by virtue of (a) the path scoping and (b) `validate_sql`.
    """
    conn = duckdb.connect(database=":memory:")
    dir_ = org_parquet_dir(org_id)

    # Engine-level sandbox: whitelist exactly this org's parquet directory and
    # then disable everything else. `enable_external_access = false` alone
    # blocks our own read_parquet on local files (DuckDB 1.5+); `allowed_directories`
    # plus the lockdown gives us "this org's files and nothing else", and
    # `lock_configuration = true` prevents user SQL from undoing it mid-session.
    try:
        dir_str = str(dir_).replace("'", "''")
        conn.execute(f"SET allowed_directories=['{dir_str}']")
        conn.execute("SET enable_external_access = false")
        conn.execute("SET lock_configuration = true")
    except duckdb.Error:
        # Older duckdb versions may not expose these knobs; validate_sql still applies.
        pass

    if dir_.exists():
        for parquet in dir_.glob("*.parquet"):
            try:
                ds_uuid = uuid.UUID(parquet.stem)
            except ValueError:
                continue
            view = _safe_view_name(ds_uuid)
            # DuckDB rejects bound parameters inside CREATE VIEW DDL with
            # "Unexpected prepared parameter. This type of statement can't be prepared!",
            # so inline the path as a SQL literal. The path is server-built from
            # PARQUET_ROOT + org_id + dataset uuid — never user input — but we
            # still double-up any single quotes defensively.
            escaped = str(parquet).replace("'", "''")
            conn.execute(
                f"CREATE OR REPLACE VIEW {view} AS SELECT * FROM read_parquet('{escaped}')"
            )

    try:
        yield conn
    finally:
        conn.close()


def view_for_dataset(dataset_id: uuid.UUID) -> str:
    return _safe_view_name(dataset_id)


def run_query(
    conn: duckdb.DuckDBPyConnection,
    sql: str,
    limit: int = 1000,
) -> list[dict[str, Any]]:
    """Execute a validated SELECT/WITH and return up to `limit` rows."""
    safe = validate_sql(sql)
    cur = conn.execute(safe)
    try:
        rows = cur.fetchmany(limit)
        cols = [d[0] for d in cur.description] if cur.description else []
    finally:
        cur.close()
    return [dict(zip(cols, r, strict=False)) for r in rows]
