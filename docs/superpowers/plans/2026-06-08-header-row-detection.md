# Header-Row Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect and skip preamble/title rows above the real header in uploaded CSV/Excel files, with a manual per-dataset override + re-ingest that regenerates the starter dashboard only when it's untouched.

**Architecture:** A conservative pure-pandas heuristic (`detect_header_offset`) runs per-worksheet (Excel) / per-file (CSV) during the Arq ingest job; a nullable `datasets.header_offset` column lets the user force a global offset via a new `POST /api/datasets/{id}/reingest` endpoint that re-enqueues the existing `ingest_dataset` job. A new `dashboards.customized` boolean (flipped on any layout/widget mutation) lets re-ingest regenerate the auto dashboard only when the user hasn't touched it.

**Tech Stack:** FastAPI + SQLAlchemy 2 (async, raw `text()` SQL) + Alembic + Arq, pandas/openpyxl/pyarrow in the worker, Next.js 16 client component on the web side.

**Design spec:** `docs/superpowers/specs/2026-06-08-header-row-detection-design.md`

**Branch:** `feat/header-row-detection` (already created; the `normalize_for_parquet` crash-fix from the prior task is uncommitted in the working tree — commit it as part of Task 1's commit or separately first).

**Running Python tests:** the heuristic tests import only `app.services.profile` (pandas-only). Run them with an interpreter that has `pandas`, `openpyxl`, `pyarrow` on the path, e.g. inside the api container:
`docker exec strata-api-1 sh -c 'cd /app && python -m pytest tests/test_header_detection.py -v'`
or a local venv with those three packages: `cd apps/api && PYTHONPATH=. python -m pytest tests/test_header_detection.py -v`.

---

### Task 1: `detect_header_offset` heuristic + unit tests

**Files:**
- Modify: `apps/api/app/services/profile.py` (add `detect_header_offset` next to `normalize_for_parquet`)
- Create: `apps/api/tests/test_header_detection.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_header_detection.py`:

```python
"""Unit tests for header-row detection.

`detect_header_offset` takes the first rows of a file read with header=None
and returns the 0-based index of the real header row (rows above are
preamble to skip). It is deliberately conservative: it returns 0 whenever
there is no confident single header row, so clean files and messy
multi-row-header files alike fall back to current behavior.
"""
from __future__ import annotations

import pathlib

import numpy as np
import pandas as pd

from app.services.profile import detect_header_offset

REAL_WORKBOOK = (
    pathlib.Path(__file__).resolve().parents[3]
    / "test"
    / "Ahmedabad Safe City Queries.xlsx"
)


def test_clean_header_on_row_zero_returns_zero():
    raw = pd.DataFrame(
        [
            ["Name", "Age", "City"],
            ["Alice", 30, "NYC"],
            ["Bob", 25, "LA"],
            ["Carol", 41, "SF"],
        ]
    )
    assert detect_header_offset(raw) == 0


def test_title_and_blank_above_header_is_detected():
    raw = pd.DataFrame(
        [
            ["Quarterly Report", None, None],
            [None, None, None],
            ["Name", "Age", "City"],
            ["Alice", 30, "NYC"],
            ["Bob", 25, "LA"],
            ["Carol", 41, "SF"],
        ]
    )
    assert detect_header_offset(raw) == 2


def test_no_confident_header_returns_zero():
    # Rows are sparse relative to data and data carries numbers/dups —
    # the shape of the Ahmedabad sample. No row qualifies.
    raw = pd.DataFrame(
        [
            ["Big Title", None, None, None, None, None],
            ["Group A", None, None, None, "Group B", "Group C"],
            [None, None, None, None, None, None],
            [1, 1, "Pre-Qual", 13, "x", "y"],
            [2, 1, "Capex", 114, "x", "y"],
            [3, 1, "Capex", 117, "x", "y"],
        ]
    )
    assert detect_header_offset(raw) == 0


def test_too_few_rows_returns_zero():
    assert detect_header_offset(pd.DataFrame([["only one row", 1]])) == 0
    assert detect_header_offset(pd.DataFrame()) == 0


def test_first_dense_row_that_is_numeric_is_not_picked():
    # A leading all-numeric row must not be mistaken for a header.
    raw = pd.DataFrame(
        [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
        ]
    )
    assert detect_header_offset(raw) == 0


def test_real_sample_workbook_returns_zero():
    if not REAL_WORKBOOK.exists():
        return  # sample not checked in; skip silently
    raw = pd.read_excel(REAL_WORKBOOK, engine="openpyxl", header=None, nrows=20)
    assert detect_header_offset(raw) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && PYTHONPATH=. python -m pytest tests/test_header_detection.py -v`
Expected: FAIL — `ImportError: cannot import name 'detect_header_offset' from 'app.services.profile'`.

- [ ] **Step 3: Implement `detect_header_offset`**

In `apps/api/app/services/profile.py`, add this function immediately after `normalize_for_parquet` (and before `_to_scalar`):

```python
def detect_header_offset(raw_df: pd.DataFrame, max_scan: int = 20) -> int:
    """Find the header row in a frame read with header=None.

    Returns the 0-based index of the first row that confidently looks like a
    header (a text-label row, about as populated as the data beneath it),
    with all rows above treated as preamble/title to skip. Returns 0 when no
    row qualifies — the safe default that keeps clean files and messy
    multi-row-header files (which no single-row heuristic handles) on current
    behavior. Conservative on purpose: a wrong guess is worse than none.
    """
    n_rows = len(raw_df)
    if n_rows < 2:
        return 0
    n_cols = raw_df.shape[1]
    if n_cols == 0:
        return 0

    scan = min(max_scan, n_rows)

    def fill_ratio(idx: int) -> float:
        row = raw_df.iloc[idx]
        return float(row.notna().sum()) / n_cols

    for r in range(scan):
        if r >= n_rows - 1:  # need at least one data row below
            break
        row = raw_df.iloc[r]
        non_null = row.dropna()
        n_non_null = len(non_null)
        if n_non_null == 0:
            continue

        fill = n_non_null / n_cols
        string_ratio = sum(isinstance(v, str) for v in non_null) / n_non_null
        unique_ratio = non_null.astype(str).nunique() / n_non_null

        below = [fill_ratio(j) for j in range(r + 1, min(r + 6, n_rows))]
        below_fill = float(pd.Series(below).median()) if below else 0.0

        qualifies = (
            fill >= 0.5
            and string_ratio >= 0.8
            and unique_ratio >= 0.9
            and below_fill >= 0.5
            and fill >= 0.9 * below_fill
        )
        if qualifies:
            return r

    return 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && PYTHONPATH=. python -m pytest tests/test_header_detection.py -v`
Expected: PASS (6 passed). Also re-run the existing crash-fix tests to confirm no regression:
`cd apps/api && PYTHONPATH=. python -m pytest tests/ -v` → all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/profile.py apps/api/app/services/ingest.py apps/api/tests/
git commit -m "feat(ingest): header-row detection heuristic + Parquet-safe column normalization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(This commit also captures the uncommitted `normalize_for_parquet` crash-fix in `profile.py`/`ingest.py`/`tests/test_profile_normalize.py` from the prior task. If you prefer them separate, commit those first with their own message.)

---

### Task 2: Migration — `datasets.header_offset` + `dashboards.customized`

**Files:**
- Create: `apps/api/alembic/versions/20260608_0001_header_offset_and_dash_customized.py`

- [ ] **Step 1: Write the migration**

Create `apps/api/alembic/versions/20260608_0001_header_offset_and_dash_customized.py`:

```python
"""add datasets.header_offset and dashboards.customized

Revision ID: 20260608_0001
Revises: 20260516_0001
Create Date: 2026-06-08 12:00:00.000000

header_offset (nullable int) is the user's manual header-row override for a
dataset: NULL = auto-detect on ingest; N = force header on row N for every
sheet/CSV. customized (bool) marks a dashboard the user has touched (layout
saved or any widget added/edited/removed) so re-ingest only regenerates the
auto starter dashboard when it is still pristine.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260608_0001"
down_revision: Union[str, None] = "20260516_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column("header_offset", sa.Integer(), nullable=True),
    )
    op.add_column(
        "dashboards",
        sa.Column(
            "customized",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("dashboards", "customized")
    op.drop_column("datasets", "header_offset")
```

- [ ] **Step 2: Apply the migration**

Run: `make migrate` (or `docker exec strata-api-1 alembic upgrade head`).
Expected: alembic applies `20260608_0001`; no errors.

- [ ] **Step 3: Verify columns exist**

Run: `make psql` then:
```sql
\d datasets
\d dashboards
```
Expected: `header_offset | integer` on datasets (nullable), `customized | boolean | not null default false` on dashboards.

- [ ] **Step 4: Commit**

```bash
git add apps/api/alembic/versions/20260608_0001_header_offset_and_dash_customized.py
git commit -m "feat(db): add datasets.header_offset and dashboards.customized

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Worker — apply detection/override in `_read_to_frame` + `ingest_dataset`

**Files:**
- Modify: `apps/api/app/services/ingest.py`

- [ ] **Step 1: Import the detector**

In `apps/api/app/services/ingest.py`, change the profile import line:

```python
from app.services.profile import (
    ColumnProfile,
    detect_header_offset,
    normalize_for_parquet,
    profile_dataframe,
)
```

Add `HEADER_SCAN_ROWS = 20` next to the existing `CSV_CHUNK_ROWS = 50_000` constant.

- [ ] **Step 2: Add a header-resolution helper**

Add this helper above `_read_to_frame`:

```python
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
    except Exception:  # noqa: BLE001 — detection is best-effort
        logger.exception("header detection failed; defaulting to row 0")
        return 0
```

- [ ] **Step 3: Thread `header_offset` through `_read_to_frame`**

Replace the whole `_read_to_frame` function with:

```python
def _read_to_frame(
    local_path: str,
    source_kind: str,
    worksheet_names: list[str] | None,
    header_offset: int | None = None,
) -> pd.DataFrame:
    if source_kind == "csv":
        peek = pd.read_csv(
            local_path, header=None, nrows=HEADER_SCAN_ROWS, low_memory=False
        )
        header_row = _resolve_header(peek, header_offset)
        chunks: list[pd.DataFrame] = []
        for chunk in pd.read_csv(
            local_path,
            header=header_row,
            chunksize=CSV_CHUNK_ROWS,
            low_memory=False,
        ):
            chunks.append(chunk)
        if not chunks:
            return pd.DataFrame()
        return pd.concat(chunks, ignore_index=True)
    if source_kind in ("xlsx", "xls"):
        # xlrd 2.x reads only legacy .xls; openpyxl handles .xlsx.
        engine = "openpyxl" if source_kind == "xlsx" else "xlrd"

        def read_sheet(sheet: str | int) -> pd.DataFrame:
            peek = pd.read_excel(
                local_path,
                sheet_name=sheet,
                header=None,
                nrows=HEADER_SCAN_ROWS,
                engine=engine,
            )
            header_row = _resolve_header(peek, header_offset)
            return pd.read_excel(
                local_path, sheet_name=sheet, header=header_row, engine=engine
            )

        # Backward-compat: pre-feature rows have worksheet_names=NULL and
        # default to first-sheet (current behaviour).
        if not worksheet_names:
            return read_sheet(0)
        try:
            tagged: list[pd.DataFrame] = []
            for name in worksheet_names:
                df = read_sheet(name)
                df.insert(0, "_sheet", name)
                tagged.append(df)
        except ValueError as e:
            raise ValueError("worksheet_not_found") from e
        if len(tagged) == 1:
            return tagged[0]
        # Multi-pick: abort if the selected sheets share zero columns
        # (excluding the synthetic _sheet column we just inserted).
        col_sets = [set(df.columns) - {"_sheet"} for df in tagged]
        if not set.intersection(*col_sets):
            raise ValueError("no_common_columns")
        # sort=False preserves first-seen column order; missing columns
        # NULL-fill automatically.
        return pd.concat(tagged, ignore_index=True, sort=False)
    raise ValueError(f"unsupported source_kind: {source_kind}")
```

Note: a bad worksheet name now surfaces while reading inside the loop, so the
`worksheet_not_found` translation moved to wrap the loop (previously it wrapped
the single `pd.read_excel(sheet_name=[...])` call).

- [ ] **Step 4: Read `header_offset` from the row and pass it in**

In `ingest_dataset`, update the bootstrap SELECT to include the column:

```python
            row = conn.execute(
                text(
                    "SELECT org_id, source_kind, object_key, worksheet_names, "
                    "header_offset "
                    "FROM datasets "
                    "WHERE id = :id AND status IN ('pending','ingesting','error')"
                ),
                {"id": dsid},
            ).first()
```

After the existing `worksheet_names: list[str] | None = row.worksheet_names` line, add:

```python
    header_offset: int | None = row.header_offset
```

Change the read call from:

```python
            df = _read_to_frame(str(local), source_kind, worksheet_names)
```
to:
```python
            df = _read_to_frame(str(local), source_kind, worksheet_names, header_offset)
```

- [ ] **Step 5: Verify typecheck**

Run: `docker exec strata-api-1 sh -c 'cd /app && mypy app/services/ingest.py'` (or `cd apps/api && mypy app/services/ingest.py` in a deps-complete venv).
Expected: no new errors. (If mypy isn't wired in your env, at minimum import the module: `docker exec strata-api-1 python -c "import app.services.ingest"` → no error.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/ingest.py
git commit -m "feat(ingest): apply header detection/override per sheet/CSV in worker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Worker — regenerate starter dashboard only when untouched

**Files:**
- Modify: `apps/api/app/services/ingest.py`

- [ ] **Step 1: Import the cache service**

In `apps/api/app/services/ingest.py`, add to the existing app imports:

```python
from app.services import cache
```

- [ ] **Step 2: Add the prepare/regenerate helper**

Add this function after `_build_starter_dashboard`:

```python
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
```

- [ ] **Step 3: Use it in `ingest_dataset`**

Replace the existing best-effort starter-dashboard block:

```python
        # Best-effort: build the starter dashboard. Errors here don't fail
        # ingestion — the dataset is still queryable without an auto-dashboard.
        dashboard_id: str | None = None
        try:
            dashboard_id = _build_starter_dashboard(
                sync_engine, org_id, dsid, ds_name, row_count, column_records
            )
        except Exception:  # noqa: BLE001
            logger.exception("autodash failed for %s", dataset_id)
```

with:

```python
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
                except Exception:  # noqa: BLE001
                    logger.exception("widget cache bust failed for %s", wid)
            if should_build:
                dashboard_id = _build_starter_dashboard(
                    sync_engine, org_id, dsid, ds_name, row_count, column_records
                )
        except Exception:  # noqa: BLE001
            logger.exception("autodash failed for %s", dataset_id)
```

- [ ] **Step 4: Verify import**

Run: `docker exec strata-api-1 python -c "import app.services.ingest"` (after rebuilding/recreating, or run against a deps-complete venv).
Expected: no error.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/ingest.py
git commit -m "feat(ingest): regenerate auto dashboard on re-ingest only when untouched

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: API — flip `dashboards.customized` on user mutations

**Files:**
- Modify: `apps/api/app/routers/dashboards.py`

- [ ] **Step 1: Mark customized on layout save**

In `update_layout` (the `PATCH /dashboards/{dashboard_id}` handler), change the UPDATE to also set the flag:

```python
    res = await session.execute(
        text(
            "UPDATE dashboards SET layout_json = CAST(:layout AS jsonb), "
            "customized = true, updated_at = NOW() WHERE id = :id"
        ),
        {"layout": json.dumps(body.layout), "id": dashboard_id},
    )
```

- [ ] **Step 2: Mark customized on widget create**

In `create_widget`, immediately after the widget INSERT `row = (...).one()` and before the `return WidgetOut(...)`, add:

```python
    await session.execute(
        text("UPDATE dashboards SET customized = true WHERE id = :d"),
        {"d": body.dashboard_id},
    )
```

- [ ] **Step 3: Mark customized on widget update**

In `update_widget`, after `updated = (...).one()` and before `await cache.bust_widget(widget_id)`, add (using the parent id from the row we already loaded):

```python
    await session.execute(
        text("UPDATE dashboards SET customized = true WHERE id = :d"),
        {"d": existing.dashboard_id},
    )
```

- [ ] **Step 4: Mark customized on widget delete**

Replace the body of `delete_widget` with a version that captures the parent dashboard via `RETURNING` and flips the flag:

```python
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
```

- [ ] **Step 5: Verify import**

Run: `docker exec strata-api-1 python -c "import app.routers.dashboards"`.
Expected: no error.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routers/dashboards.py
git commit -m "feat(dashboards): mark customized on layout/widget mutations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: API — `POST /api/datasets/{id}/reingest` endpoint

**Files:**
- Modify: `apps/api/app/routers/datasets.py`

- [ ] **Step 1: Add the request/response models**

In `apps/api/app/routers/datasets.py`, after the `RowsResponse` model (or near the other models), add:

```python
class ReingestRequest(BaseModel):
    # None clears the override → auto-detect on the next ingest.
    header_offset: int | None = Field(default=None, ge=0, le=100)


class ReingestResponse(BaseModel):
    id: str
    status: str
    header_offset: int | None
```

- [ ] **Step 2: Add the endpoint**

Add this handler (place it after `get_rows` and before `delete_preview`). It reuses the busy-status guard and the Arq enqueue pattern already used by `register`:

```python
@router.post("/{dataset_id}/reingest", response_model=ReingestResponse)
async def reingest(
    dataset_id: uuid.UUID,
    body: ReingestRequest,
    session: AsyncSession = Depends(tenant_session),
    plan: Plan = Depends(current_plan),
) -> ReingestResponse:
    """Re-run ingestion on an existing dataset with a header-row override.

    The original upload is still in MinIO, so this just records the override,
    resets status to pending, and re-enqueues the same `ingest_dataset` job.
    No new dataset capacity is consumed (same dataset/parquet/object_key).
    """
    ds = (
        await session.execute(
            text("SELECT id, status FROM datasets WHERE id = :id"),
            {"id": dataset_id},
        )
    ).first()
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset_not_found")
    if ds.status in _DELETE_BUSY_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "dataset_busy")

    updated = (
        await session.execute(
            text(
                "UPDATE datasets SET header_offset = :ho, status = 'pending', "
                "error = NULL, updated_at = NOW() WHERE id = :id "
                "RETURNING id, status, header_offset"
            ),
            {"ho": body.header_offset, "id": dataset_id},
        )
    ).one()
    await session.commit()

    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        await pool.enqueue_job("ingest_dataset", str(dataset_id))
    finally:
        await pool.aclose()

    return ReingestResponse(
        id=str(updated.id),
        status=updated.status,
        header_offset=updated.header_offset,
    )
```

- [ ] **Step 3: Add `current_plan` import**

The endpoint depends on `current_plan` (capacity-neutral but per convention every write plugs in a plan dep). Update the limits import at the top of the file:

```python
from app.deps.limits import current_plan, require_dataset_capacity
```

- [ ] **Step 4: Expose `header_offset` on the dataset detail response**

So the UI can show the current override, add `header_offset` to `DatasetDetail` and the `get_dataset` query/response.

In the `DatasetDetail` model, add a field:

```python
class DatasetDetail(DatasetRow):
    columns: list[dict[str, Any]]
    header_offset: int | None = None
```

In `get_dataset`, change the SELECT to include the column:

```python
            text(
                "SELECT id, name, source_kind, status, row_count, size_bytes, "
                "error, created_at, header_offset FROM datasets WHERE id = :id"
            ),
```

and add `header_offset=ds.header_offset,` to the `DatasetDetail(...)` return.

- [ ] **Step 5: Verify import + OpenAPI route**

Run: `docker exec strata-api-1 python -c "import app.routers.datasets"` → no error.
Then exercise the route shape (busy guard / not found are easy to hit):
`docker exec strata-api-1 python -c "import app.main"` → app imports with the new route registered.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routers/datasets.py
git commit -m "feat(datasets): add reingest endpoint + expose header_offset on detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Web — "Header row" re-ingest control

**Files:**
- Create: `apps/web/components/datasets/HeaderRowControl.tsx`
- Modify: `apps/web/app/(app)/datasets/[id]/page.tsx`

- [ ] **Step 1: Create the client component**

Create `apps/web/components/datasets/HeaderRowControl.tsx`, modeled on `RefreshSheetButton` (same proxy + error pattern + `router.refresh()` so `DatasetStatusPoller` takes over once status flips to `pending`):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messageFromUnknown, parseApiError } from "@/lib/errors";

export function HeaderRowControl({
  datasetId,
  headerOffset,
}: {
  datasetId: string;
  headerOffset: number | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Display is 1-based ("Row 1" = the first row); empty = auto-detect.
  const [value, setValue] = useState(
    headerOffset == null ? "" : String(headerOffset + 1),
  );

  async function reingest(offset: number | null) {
    setPending(true);
    try {
      const res = await fetch(
        `/datasets/api?path=${encodeURIComponent(`/api/datasets/${datasetId}/reingest`)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ header_offset: offset }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      toast.success("Re-ingest queued — the page refreshes when it's ready.");
      router.refresh();
    } catch (e) {
      toast.error("Couldn't re-ingest", { description: messageFromUnknown(e) });
    } finally {
      setPending(false);
    }
  }

  function onApply() {
    const trimmed = value.trim();
    if (trimmed === "") {
      void reingest(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 101) {
      toast.error("Enter a row number between 1 and 101, or leave blank for auto.");
      return;
    }
    void reingest(parsed - 1); // back to 0-based for the API
  }

  return (
    <div className="border-border/60 bg-muted/20 flex flex-wrap items-end gap-3 rounded-2xl border p-4">
      <div className="space-y-1">
        <label htmlFor="header-row" className="text-xs font-medium">
          Header row
        </label>
        <Input
          id="header-row"
          inputMode="numeric"
          className="w-28"
          placeholder="Auto"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          {headerOffset == null
            ? "Currently auto-detected."
            : `Currently forced to row ${headerOffset + 1}.`}{" "}
          Leave blank to auto-detect.
        </p>
      </div>
      <Button type="button" size="sm" onClick={onApply} disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        {pending ? "Queuing…" : "Re-ingest"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the `Input` component path**

Run: `ls apps/web/components/ui/input.tsx`
Expected: the file exists (shadcn `Input`). If the export name differs, match the existing import style used elsewhere (grep: `grep -rn "components/ui/input" apps/web/components | head`).

- [ ] **Step 3: Wire it into the dataset detail page**

In `apps/web/app/(app)/datasets/[id]/page.tsx`:

Add the field to the `DatasetDetail` type:

```tsx
type DatasetDetail = {
  id: string;
  name: string;
  source_kind: string;
  status: string;
  row_count: number | null;
  size_bytes: number | null;
  error: string | null;
  created_at: string;
  columns: SchemaColumn[];
  header_offset: number | null;
};
```

Add the import near the other component imports:

```tsx
import { HeaderRowControl } from "@/components/datasets/HeaderRowControl";
```

Render the control for file-based datasets (not Google Sheets, which have no
re-ingestable upload). Place it inside the `<div className="space-y-6 p-6">`
block, right after the `inFlight` poller and before the error card:

```tsx
        {ds.source_kind !== "sheet" ? (
          <HeaderRowControl
            datasetId={ds.id}
            headerOffset={ds.header_offset}
          />
        ) : null}
```

- [ ] **Step 4: Verify typecheck + build**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.
Run: `cd apps/web && pnpm build`
Expected: build succeeds; the dataset detail route still compiles. (Per CLAUDE.md, `pnpm lint` is broken on Next 16 — use typecheck + build as the signal.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/datasets/HeaderRowControl.tsx "apps/web/app/(app)/datasets/[id]/page.tsx"
git commit -m "feat(web): header-row override + re-ingest control on dataset page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification

**Files:** none (manual smoke).

- [ ] **Step 1: Rebuild worker + api + web images**

Source is baked into images (no bind mounts). Run:
```bash
docker compose -f infra/docker-compose.yml build worker api web
docker compose -f infra/docker-compose.yml up -d --no-deps worker api web
```

- [ ] **Step 2: Clean-preamble file auto-detects**

Upload a CSV/XLSX with 1–2 title rows above a clean header (e.g. the
`test_title_and_blank_above_header_is_detected` shape). Confirm the dataset
ingests `ready` and the schema shows the real column names (not "Unnamed: N"
or the title).

- [ ] **Step 3: Messy sample no-ops but ingests**

Upload `test/Ahmedabad Safe City Queries.xlsx`. Confirm it now reaches
`ready` (the crash-fix) and detection left it on row 0 (columns reflect the
original first-row behavior — no crash).

- [ ] **Step 4: Manual override + regenerate-if-untouched**

On the messy dataset's detail page, set "Header row" to a value that exposes
a better header and click Re-ingest. Confirm: status flips to ingesting then
ready; the auto dashboard is regenerated from the new schema (since it was
untouched). Then drag a widget (marks customized), re-ingest again, and
confirm the dashboard is left intact this time.

- [ ] **Step 5: Busy guard**

Immediately double-click Re-ingest (or re-ingest while still ingesting).
Confirm the second call surfaces the friendly `dataset_busy` toast.

- [ ] **Step 6: Final full test run**

Run: `cd apps/api && PYTHONPATH=. python -m pytest tests/ -v` (deps-complete env / container).
Expected: all green (header detection + normalization tests).
