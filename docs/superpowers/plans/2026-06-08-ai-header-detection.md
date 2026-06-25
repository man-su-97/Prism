# AI-Assisted Header Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the cheap header heuristic is low-confidence, escalate to Claude (Haiku) to produce the data-start row + cleaned column names, applied automatically during ingest and persisted per dataset.

**Architecture:** A three-tier resolution inside the Arq worker, all decided on the 20-row peek: manual `header_offset` override → persisted `header_plan` → heuristic, escalating to an AI tool-call only when `header_confidence < 0.7`. AI output is validated + sanitized into safe SQL identifiers, applied by reading `header=None` and slicing/renaming, and persisted as a `datasets.header_plan` jsonb. Errors at every layer fall back to the heuristic.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic + Arq worker, pandas, Anthropic SDK (sync singleton, Haiku 4.5), forced tool-use for structured output.

**Design spec:** `docs/superpowers/specs/2026-06-08-ai-header-detection-design.md`

**Branch:** `feat/ai-header-detection` (already created; spec already committed).

**Running Python tests:** the new pure logic imports only `app.services.profile` (pandas) and `app.services.header_ai` (stdlib only — its `anthropic` import is lazy/inside `propose_header`). Run with the venv that has pandas/openpyxl/pyarrow/pytest:
`cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/<file> -v`. Do NOT install `anthropic` — the AI call itself is covered by manual smoke, not unit tests.

---

### Task 1: Confidence gate (`header_confidence` + `should_escalate`)

**Files:**
- Modify: `apps/api/app/services/profile.py` (add two functions after `detect_header_offset`)
- Create: `apps/api/tests/test_header_confidence.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_header_confidence.py`:

```python
"""Unit tests for the AI-escalation confidence gate.

`header_confidence` scores how header-like a candidate row is (fraction of
cells that are non-null, string, and unique). `should_escalate` is true when
that score is below threshold — the signal to call the AI tier.
"""
from __future__ import annotations

import pandas as pd

from app.services.profile import header_confidence, should_escalate


def test_clean_header_row_is_high_confidence():
    peek = pd.DataFrame(
        [["Name", "Age", "City"], ["Alice", 30, "NYC"], ["Bob", 25, "LA"]]
    )
    assert header_confidence(peek, 0) == 1.0
    assert should_escalate(peek, 0) is False


def test_sparse_title_row_is_low_confidence():
    # Ahmedabad-shaped: row 0 has one filled cell of six.
    peek = pd.DataFrame(
        [
            ["Big Title", None, None, None, None, None],
            ["Group A", None, None, None, "Group B", "Group C"],
            [None, None, None, None, None, None],
            [1, 1, "Pre-Qual", 13, "x", "y"],
        ]
    )
    assert header_confidence(peek, 0) < 0.2
    assert should_escalate(peek, 0) is True


def test_numeric_row_is_low_confidence():
    peek = pd.DataFrame([[1, 2, 3], [4, 5, 6]])
    assert header_confidence(peek, 0) == 0.0
    assert should_escalate(peek, 0) is True


def test_duplicate_labels_lower_confidence():
    peek = pd.DataFrame([["A", "A", "B"], ["1", "2", "3"]])
    # 2 unique strings (A, B) over 3 columns.
    assert abs(header_confidence(peek, 0) - (2 / 3)) < 1e-9
    assert should_escalate(peek, 0) is True  # 0.666 < 0.7


def test_out_of_range_or_too_few_rows():
    assert header_confidence(pd.DataFrame([["A", "B"]]), 0) == 1.0
    assert should_escalate(pd.DataFrame([["A", "B"]]), 0) is False  # <2 rows
    assert header_confidence(pd.DataFrame(), 0) == 0.0
    assert header_confidence(pd.DataFrame([["A"], ["B"]]), 5) == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/test_header_confidence.py -v`
Expected: FAIL — `ImportError: cannot import name 'header_confidence'`.

- [ ] **Step 3: Implement the functions**

In `apps/api/app/services/profile.py`, add immediately AFTER `detect_header_offset` (and before `_to_scalar`):

```python
def header_confidence(peek: pd.DataFrame, offset: int) -> float:
    """How header-like is row `offset`: the fraction of columns whose cell at
    that row is a non-null, unique string. 1.0 = every column has a distinct
    text label (a clean header); low = sparse/numeric/duplicated (needs help).
    Returns 0.0 when the row is out of range or the frame has no columns.
    """
    n_rows = len(peek)
    n_cols = peek.shape[1] if n_rows else 0
    if n_cols == 0 or offset < 0 or offset >= n_rows:
        return 0.0
    row = peek.iloc[offset]
    strings = {v for v in row.dropna() if isinstance(v, str)}
    return len(strings) / n_cols


def should_escalate(
    peek: pd.DataFrame, offset: int, threshold: float = 0.7
) -> bool:
    """True when the chosen header row is not confidently a header — the
    signal to escalate to the AI tier. Needs >=2 rows (a header + data)."""
    if len(peek) < 2:
        return False
    return header_confidence(peek, offset) < threshold
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/test_header_confidence.py -v`
Expected: PASS (5 passed). Also `pytest tests/ -q` → all green (prior tests unaffected).

- [ ] **Step 5: Commit**

```bash
cd /home/vicky/Work/projects/strata && git add apps/api/app/services/profile.py apps/api/tests/test_header_confidence.py && git commit -m "feat(profile): header confidence gate for AI escalation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `header_ai` pure helpers (HeaderPlan + sanitize_columns) + model config

**Files:**
- Create: `apps/api/app/services/header_ai.py`
- Modify: `apps/api/app/services/anthropic_client.py` (add model constants)
- Create: `apps/api/tests/test_header_ai_sanitize.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_header_ai_sanitize.py`:

```python
"""Unit tests for AI column-name sanitization.

AI-proposed names become SQL identifiers (they land in dataset_columns and the
DuckDB view), so they must be coerced into exactly n_cols safe, unique,
non-empty strings before use.
"""
from __future__ import annotations

from app.services.header_ai import HeaderPlan, sanitize_columns


def test_returns_exactly_n_cols():
    assert len(sanitize_columns(["a", "b"], 4)) == 4
    assert len(sanitize_columns(["a", "b", "c", "d"], 2)) == 2


def test_empty_and_none_become_positional():
    out = sanitize_columns(["", None, "  "], 3)
    assert out == ["column_1", "column_2", "column_3"]


def test_dedupes_case_insensitively():
    out = sanitize_columns(["Name", "name", "NAME"], 3)
    assert out == ["Name", "name 2", "NAME 3"]


def test_collapses_whitespace_and_newlines():
    assert sanitize_columns(["Sr.\n No."], 1) == ["Sr. No."]


def test_caps_length():
    long = "x" * 300
    assert len(sanitize_columns([long], 1)[0]) == 128


def test_headerplan_dataclass():
    p = HeaderPlan(data_start_row=2, columns=["a", "b"])
    assert p.data_start_row == 2 and p.columns == ["a", "b"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/test_header_ai_sanitize.py -v`
Expected: FAIL — module `app.services.header_ai` does not exist.

- [ ] **Step 3: Create `header_ai.py` with the pure helpers**

Create `apps/api/app/services/header_ai.py`. NOTE: the `anthropic` import must stay LAZY (inside `propose_header`, added in Task 3) so this module imports with stdlib only and stays unit-testable. For now:

```python
"""AI-assisted header detection.

When the cheap heuristic is low-confidence, the worker escalates here: Claude
(Haiku) is shown the first rows of a sheet and returns, via a forced tool call,
the 0-based first DATA row and a clean name per column. Output is validated and
sanitized into safe SQL identifiers before it can reach DuckDB.

The `anthropic` import is deliberately lazy (inside `propose_header`) so the
pure validation/sanitization logic is importable and testable without the SDK.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_MAX_NAME_LEN = 128


@dataclass
class HeaderPlan:
    data_start_row: int       # 0-based index of the first DATA row
    columns: list[str]        # exactly one sanitized name per column


def sanitize_columns(names: list[Any], n_cols: int) -> list[str]:
    """Coerce `names` into exactly `n_cols` safe, unique, non-empty strings.

    Whitespace/newlines collapse to single spaces; non-printable chars are
    stripped; over-long names are capped; empties become `column_{i}`; and
    case-insensitive duplicates get a numeric suffix. AI names flow into
    dataset_columns and DuckDB identifiers, so this is the safety boundary.
    """
    out: list[str] = []
    seen: dict[str, int] = {}
    for i in range(n_cols):
        raw = names[i] if i < len(names) else ""
        name = "" if raw is None else str(raw)
        name = re.sub(r"\s+", " ", name).strip()
        name = "".join(ch for ch in name if ch.isprintable())
        name = name[:_MAX_NAME_LEN]
        if not name:
            name = f"column_{i + 1}"
        key = name.casefold()
        if key in seen:
            seen[key] += 1
            name = f"{name} {seen[key]}"
        else:
            seen[key] = 1
        out.append(name)
    return out
```

- [ ] **Step 4: Add model constants to `anthropic_client.py`**

In `apps/api/app/services/anthropic_client.py`, after the existing `OVERVIEW_MAX_TOKENS = 600` line, add:

```python
# Header detection is a cheap structured-extraction task — use a small, fast
# model. Override with ANTHROPIC_HEADER_MODEL.
HEADER_MODEL = os.getenv("ANTHROPIC_HEADER_MODEL", "claude-haiku-4-5-20251001")
HEADER_MAX_TOKENS = 1024
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/test_header_ai_sanitize.py -v`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
cd /home/vicky/Work/projects/strata && git add apps/api/app/services/header_ai.py apps/api/app/services/anthropic_client.py apps/api/tests/test_header_ai_sanitize.py && git commit -m "feat(header_ai): HeaderPlan + column sanitization + Haiku model config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `propose_header` — tool schema, parse, validate

**Files:**
- Modify: `apps/api/app/services/header_ai.py`
- Create: `apps/api/tests/test_header_ai_propose.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_header_ai_propose.py`:

```python
"""Unit tests for AI tool-output parsing/validation (no network).

The risky logic is turning a Claude tool_use block into a validated HeaderPlan.
We feed fake blocks; the live API call in `propose_header` is covered by manual
smoke, not here.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.services.header_ai import (
    HeaderPlan,
    _extract_tool_input,
    _plan_from_tool_input,
    _render_grid,
)


def _resp(blocks):
    return SimpleNamespace(content=blocks)


def test_extract_tool_input_finds_matching_block():
    block = SimpleNamespace(
        type="tool_use", name="report_header", input={"data_start_row": 1, "columns": ["a"]}
    )
    assert _extract_tool_input(_resp([block]), "report_header") == {
        "data_start_row": 1,
        "columns": ["a"],
    }


def test_extract_tool_input_returns_none_when_absent():
    text_block = SimpleNamespace(type="text", text="hi")
    assert _extract_tool_input(_resp([text_block]), "report_header") is None


def test_valid_plan_is_sanitized():
    plan = _plan_from_tool_input(
        {"data_start_row": 2, "columns": ["Name", "name"]}, n_cols=2, n_peek_rows=5
    )
    assert isinstance(plan, HeaderPlan)
    assert plan.data_start_row == 2
    assert plan.columns == ["Name", "name 2"]


def test_rejects_column_count_mismatch():
    assert _plan_from_tool_input(
        {"data_start_row": 1, "columns": ["a", "b"]}, n_cols=3, n_peek_rows=5
    ) is None


def test_rejects_out_of_range_row():
    assert _plan_from_tool_input(
        {"data_start_row": 9, "columns": ["a"]}, n_cols=1, n_peek_rows=5
    ) is None
    assert _plan_from_tool_input(
        {"data_start_row": -1, "columns": ["a"]}, n_cols=1, n_peek_rows=5
    ) is None


def test_rejects_malformed_input():
    assert _plan_from_tool_input({}, n_cols=1, n_peek_rows=5) is None
    assert _plan_from_tool_input(
        {"data_start_row": "x", "columns": ["a"]}, n_cols=1, n_peek_rows=5
    ) is None
    assert _plan_from_tool_input(
        {"data_start_row": 1, "columns": "nope"}, n_cols=1, n_peek_rows=5
    ) is None


def test_render_grid_includes_row_indices_and_handles_nan():
    grid = _render_grid([["A", None], ["x", 1]])
    assert "row 0" in grid and "row 1" in grid
    assert "A" in grid and "x" in grid
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/test_header_ai_propose.py -v`
Expected: FAIL — names `_extract_tool_input` / `_plan_from_tool_input` / `_render_grid` not defined.

- [ ] **Step 3: Implement the tool schema, parse, validate, and `propose_header`**

Append to `apps/api/app/services/header_ai.py`:

```python
REPORT_HEADER_TOOL = {
    "name": "report_header",
    "description": (
        "Report where the data table's header/data begins and the cleaned "
        "column names."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "data_start_row": {
                "type": "integer",
                "description": "0-based index of the first row that contains DATA "
                "(not titles, notes, or header labels).",
            },
            "columns": {
                "type": "array",
                "items": {"type": "string"},
                "description": "One short, human-readable name per column, in order, "
                "inferred from the header row(s) above the data.",
            },
        },
        "required": ["data_start_row", "columns"],
    },
}

_SYSTEM = (
    "You are given the first rows of a spreadsheet as an indexed grid. Some "
    "files have title/notes rows or multi-row headers above the real table. "
    "Identify the 0-based index of the first row that contains DATA (not "
    "titles, notes, or header labels), and produce exactly one short, unique, "
    "human-readable column name per column, inferring names from the header "
    "row(s) directly above the data. Never invent or drop columns; return "
    "exactly as many names as there are columns. Call the report_header tool."
)


def _render_grid(peek_rows: list[list[Any]]) -> str:
    """Render the peeked rows as an indexed, pipe-separated grid for the model."""
    lines: list[str] = []
    for i, row in enumerate(peek_rows):
        cells = ["" if c is None or c != c else str(c) for c in row]  # c!=c → NaN
        lines.append(f"row {i}: " + " | ".join(cells))
    return "\n".join(lines)


def _extract_tool_input(resp: Any, tool_name: str) -> dict[str, Any] | None:
    """Return the input dict of the first tool_use block named `tool_name`."""
    for block in getattr(resp, "content", []) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == tool_name:
            inp = getattr(block, "input", None)
            return inp if isinstance(inp, dict) else None
    return None


def _plan_from_tool_input(
    tool_input: Any, n_cols: int, n_peek_rows: int
) -> HeaderPlan | None:
    """Validate a tool_use input dict into a HeaderPlan, or None if invalid."""
    if not isinstance(tool_input, dict):
        return None
    dsr = tool_input.get("data_start_row")
    cols = tool_input.get("columns")
    if not isinstance(dsr, int) or isinstance(dsr, bool) or dsr < 0 or dsr >= n_peek_rows:
        return None
    if not isinstance(cols, list) or len(cols) != n_cols:
        return None
    return HeaderPlan(data_start_row=dsr, columns=sanitize_columns(cols, n_cols))


def propose_header(peek_rows: list[list[Any]], sheet_key: str) -> HeaderPlan | None:
    """Ask Claude for the header location + cleaned names. None on any failure.

    Never raises — mirrors `overview.generate_overview`. The `anthropic` import
    is lazy so this module stays unit-testable without the SDK.
    """
    if not peek_rows:
        return None
    n_cols = max((len(r) for r in peek_rows), default=0)
    if n_cols == 0:
        return None
    try:
        from app.services.anthropic_client import (
            HEADER_MAX_TOKENS,
            HEADER_MODEL,
            client,
        )

        anth = client()
    except Exception:  # noqa: BLE001 — key missing / SDK absent → skip AI tier
        logger.info("anthropic unavailable; skipping AI header detection")
        return None
    try:
        resp = anth.messages.create(
            model=HEADER_MODEL,
            max_tokens=HEADER_MAX_TOKENS,
            system=_SYSTEM,
            tools=[REPORT_HEADER_TOOL],
            tool_choice={"type": "tool", "name": "report_header"},
            messages=[{"role": "user", "content": _render_grid(peek_rows)}],
        )
    except Exception:  # noqa: BLE001 — API/network/timeout → fall back to heuristic
        logger.exception("AI header detection call failed for sheet %s", sheet_key)
        return None
    tool_input = _extract_tool_input(resp, "report_header")
    return _plan_from_tool_input(tool_input, n_cols, len(peek_rows))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/test_header_ai_propose.py -v`
Expected: PASS (7 passed). Confirm the module still imports without `anthropic`: `PYTHONPATH=. /tmp/ingest-venv/bin/python -c "import app.services.header_ai; print('ok')"`.

- [ ] **Step 5: Commit**

```bash
cd /home/vicky/Work/projects/strata && git add apps/api/app/services/header_ai.py apps/api/tests/test_header_ai_propose.py && git commit -m "feat(header_ai): forced-tool propose_header with validation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Migration — `datasets.header_plan`

**Files:**
- Create: `apps/api/alembic/versions/20260608_0002_datasets_header_plan.py`

- [ ] **Step 1: Write the migration**

Create `apps/api/alembic/versions/20260608_0002_datasets_header_plan.py`:

```python
"""add datasets.header_plan jsonb

Revision ID: 20260608_0002
Revises: 20260608_0001
Create Date: 2026-06-08 13:30:00.000000

header_plan persists the AI-assisted header decision per worksheet so re-ingest
is deterministic and the API is paid once. Shape:
  { "<sheet_key>": {"data_start_row": int, "columns": [str, ...]}, ... }
where sheet_key is the worksheet title (multi-sheet) or "__file__" (csv /
first-sheet). NULL = no AI plan (heuristic or manual override).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260608_0002"
down_revision: Union[str, None] = "20260608_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column(
            "header_plan",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("datasets", "header_plan")
```

- [ ] **Step 2: Verify statically (stack may be down)**

Run: `cd apps/api && /tmp/ingest-venv/bin/python -c "import ast; ast.parse(open('alembic/versions/20260608_0002_datasets_header_plan.py').read()); print('ok')"`
Confirm `20260608_0001` is the current single head: `grep -rl "down_revision.*20260608_0001" alembic/versions/` lists only this new file.
If the stack is up: `make migrate` then `make psql` → `\d datasets` shows `header_plan | jsonb`.

- [ ] **Step 3: Commit**

```bash
cd /home/vicky/Work/projects/strata && git add apps/api/alembic/versions/20260608_0002_datasets_header_plan.py && git commit -m "feat(db): add datasets.header_plan jsonb

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Worker wiring — resolve/apply/persist the AI plan

**Files:**
- Modify: `apps/api/app/services/ingest.py`

This is the integration seam. Read the current file first; the anchors below match the post-header-offset state.

- [ ] **Step 1: Imports**

In `apps/api/app/services/ingest.py`, extend the profile import to add the gate, and import the AI helpers:

```python
from app.services.profile import (
    ColumnProfile,
    detect_header_offset,
    header_confidence,  # noqa: F401  (kept for parity; should_escalate uses it)
    normalize_for_parquet,
    profile_dataframe,
    should_escalate,
)
from app.services.header_ai import HeaderPlan, propose_header
```

(If ruff flags `header_confidence` as unused, drop it from the import — only `should_escalate` is needed here.)

- [ ] **Step 2: Add plan resolve + apply helpers above `_read_to_frame`**

Insert after `_resolve_header` and before `_read_to_frame`:

```python
def _resolve_header_plan(
    peek: pd.DataFrame,
    sheet_key: str,
    header_offset: int | None,
    existing_plan: dict[str, Any] | None,
) -> tuple[int | None, HeaderPlan | None, bool]:
    """Three-tier resolution on the peek.

    Returns (offset, plan, is_new_ai):
      - offset set, plan None  → read with header=offset (manual or heuristic).
      - plan set, offset None  → read header=None, slice+rename.
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
            pass  # corrupt entry → fall through to heuristic
    try:  # 3. heuristic
        h = detect_header_offset(peek, max_scan=HEADER_SCAN_ROWS)
    except Exception:  # noqa: BLE001
        h = 0
    if not should_escalate(peek, h):
        return h, None, False
    plan = propose_header(peek.values.tolist(), sheet_key)
    if plan is None:
        return h, None, False
    return None, plan, True


def _apply_plan(raw: pd.DataFrame, plan: HeaderPlan) -> pd.DataFrame | None:
    """Slice off preamble and assign the planned names. None on shape mismatch
    (e.g. a persisted plan against a changed file) → caller falls back."""
    if plan.data_start_row >= len(raw):
        return None
    body = raw.iloc[plan.data_start_row:].reset_index(drop=True)
    if body.shape[1] != len(plan.columns):
        return None
    body.columns = plan.columns
    return body
```

- [ ] **Step 3: Rewrite `_read_to_frame` to thread plans in and out**

Replace the entire `_read_to_frame` function with this version. It adds an `existing_plan` param and returns `(df, plan_out)` where `plan_out` is the AI plans produced this run (to persist):

```python
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
            raw = reader(sheet, header=None, nrows=None)
            applied = _apply_plan(raw, plan)
            if applied is not None:
                if is_new:
                    plan_out[sheet_key] = {
                        "data_start_row": plan.data_start_row,
                        "columns": plan.columns,
                    }
                return applied
            # plan didn't fit the data → fall back to the heuristic offset.
            offset = _resolve_header(peek, None)
        return reader(sheet, header=offset, nrows=None)

    if source_kind == "csv":
        def csv_reader(_sheet: Any, header: Any, nrows: Any) -> pd.DataFrame:
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
```

Note the CSV chunked-read is preserved (only the full `header=int` read chunks; the peek uses `nrows`). The `_sheet` tagging, single-sheet shortcut, `no_common_columns` guard, and union are unchanged.

- [ ] **Step 4: Thread `header_plan` through `ingest_dataset`**

(a) Add `header_plan` to the bootstrap SELECT. Change:
```python
                    "SELECT org_id, source_kind, object_key, worksheet_names, "
                    "header_offset "
```
to:
```python
                    "SELECT org_id, source_kind, object_key, worksheet_names, "
                    "header_offset, header_plan "
```

(b) After the existing `header_offset: int | None = row.header_offset` line, add:
```python
    existing_plan: dict[str, Any] | None = row.header_plan
```

(c) Change the read call (note it now returns a tuple). Replace:
```python
            df = _read_to_frame(str(local), source_kind, worksheet_names, header_offset)
```
with:
```python
            df, new_plan = _read_to_frame(
                str(local), source_kind, worksheet_names, header_offset, existing_plan
            )
```

(d) Persist any newly-produced AI plan. The status `UPDATE datasets SET status='ready'...` runs inside a `with sync_engine.begin() as conn:` block that ends right after `ds_name = ds_name_row.name if ds_name_row else str(dsid)`. INSERT this guarded write immediately AFTER that block closes and immediately BEFORE the `# Best-effort: build the starter dashboard ...` comment (so it's at the same indentation as that comment, inside the `try:` of the success path):
```python
        if new_plan:
            merged = {**(existing_plan or {}), **new_plan}
            with sync_engine.begin() as conn:
                conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
                conn.execute(
                    text("UPDATE datasets SET header_plan = CAST(:plan AS jsonb) WHERE id = :id"),
                    {"plan": json.dumps(merged), "id": dsid},
                )

```

- [ ] **Step 5: Static verification (stack down, heavy deps absent)**

Run: `cd apps/api && /tmp/ingest-venv/bin/python -c "import ast; ast.parse(open('app/services/ingest.py').read()); print('syntax ok')"`
Run: `uvx ruff@latest check app/services/ingest.py app/services/header_ai.py app/services/profile.py` — report new vs pre-existing (RUF046/RUF100 BLE-noqa noise is pre-existing). Re-read `git diff` to confirm scope.
Run the python tests to confirm no regression: `PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/ -q` (expect all green — header_ai/profile imports must resolve).

- [ ] **Step 6: Commit**

```bash
cd /home/vicky/Work/projects/strata && git add apps/api/app/services/ingest.py && git commit -m "feat(ingest): AI header escalation — resolve, apply, persist per sheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Re-ingest endpoint clears `header_plan`

**Files:**
- Modify: `apps/api/app/routers/datasets.py`

- [ ] **Step 1: Update the reingest UPDATE**

In `apps/api/app/routers/datasets.py`, in the `reingest` handler, the UPDATE currently is:
```python
                "UPDATE datasets SET header_offset = :ho, status = 'pending', "
                "error = NULL, updated_at = NOW() WHERE id = :id "
                "RETURNING id, status, header_offset"
```
Change it to also clear `header_plan`:
```python
                "UPDATE datasets SET header_offset = :ho, header_plan = NULL, "
                "status = 'pending', error = NULL, updated_at = NOW() WHERE id = :id "
                "RETURNING id, status, header_offset"
```

(An explicit user re-ingest means "redo from scratch": a manual offset supersedes AI; an auto re-ingest re-runs heuristic + AI fresh.)

- [ ] **Step 2: Verify**

Run: `cd apps/api && /tmp/ingest-venv/bin/python -c "import ast; ast.parse(open('app/routers/datasets.py').read()); print('ok')"`
`git diff` shows only the one UPDATE statement changed.

- [ ] **Step 3: Commit**

```bash
cd /home/vicky/Work/projects/strata && git add apps/api/app/routers/datasets.py && git commit -m "feat(datasets): clear header_plan on re-ingest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: End-to-end verification

**Files:** none (manual smoke on the running stack).

- [ ] **Step 1: Apply migration + rebuild**

```bash
make migrate    # applies 20260608_0002
docker compose -f infra/docker-compose.yml build worker api
docker compose -f infra/docker-compose.yml up -d --no-deps worker api
```
Confirm `ANTHROPIC_API_KEY` is set in `apps/api/.env` (worker reads it); if blank, the AI tier silently skips and you'll only see heuristic behavior.

- [ ] **Step 2: Confirm column + key**

`make psql` → `\d datasets` shows `header_plan | jsonb`.
`docker exec strata-api-1 printenv ANTHROPIC_API_KEY | head -c 4` prints a non-empty prefix (or note it's unset).

- [ ] **Step 3: Messy file gets AI-cleaned columns**

Re-upload `test/Ahmedabad Safe City Queries.xlsx` while tailing the worker:
`docker compose -f infra/docker-compose.yml logs -f worker`.
Expected: ingests to `ready`; the dataset's schema now shows AI-derived names (e.g. "Sr. No.", "Section No.", "Content of RFP", "Clarification Sought") instead of the title/`Unnamed: N`. Verify the persisted plan:
`make psql` → `SELECT header_plan FROM datasets ORDER BY created_at DESC LIMIT 1;` → a jsonb with `data_start_row` + `columns`.

- [ ] **Step 4: Clean file does NOT call the AI**

Upload a clean single-header CSV. Expected: ingests `ready`, `header_plan` stays NULL (heuristic was confident, no escalation), no AI latency.

- [ ] **Step 5: Override + clear**

On the messy dataset, use the "Header row" control to force a row and Re-ingest. Expected: `header_plan` is cleared to NULL and the forced offset is applied. Then re-ingest with blank (auto) → AI runs again and re-populates `header_plan`.

- [ ] **Step 6: Final test run**

`cd apps/api && PYTHONPATH=. /tmp/ingest-venv/bin/python -m pytest tests/ -q` → all green.
