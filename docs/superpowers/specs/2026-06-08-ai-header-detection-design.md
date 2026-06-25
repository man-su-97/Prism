# AI-assisted header detection — design

**Date:** 2026-06-08
**Status:** approved (pending spec review)
**Context:** Follow-up to header-row detection. The conservative heuristic
(`detect_header_offset`) deliberately returns offset 0 on files with no single
clean header — including real-world reports like
`Ahmedabad Safe City Queries.xlsx`, whose header spans multiple merged rows.
For those, an LLM shown the first rows can both locate where the data starts
and synthesize clean column names. This adds a tiered AI escalation that fires
only when the heuristic is low-confidence.

## Goals / non-goals

**Goals**
- When the cheap heuristic is low-confidence, escalate to Claude to produce a
  header location **and** cleaned column names, applied automatically during
  ingest.
- Keep clean files (the ~95%) on the free heuristic — no API call, no latency.
- Never block or fail ingestion because of the AI tier.
- Make AI-derived names safe as SQL identifiers (same sanitization the query
  paths assume) and deterministic across re-ingests (persist the plan).

**Non-goals**
- No upload-time preview/confirm UI. AI auto-applies; the existing "Header row"
  re-ingest control is the override (chosen: auto-apply).
- No per-plan gating. Available on all plans; token spend is a system ingest
  cost, NOT charged to the chat-token entitlement (chosen).
- No footer/blank-row dropping or full structural parse (scope is header row +
  column names only).
- No streaming; a single non-streaming `messages.create` in the worker.

## Decisions (from brainstorming)

1. **Scope:** AI returns the header location + cleaned column names (collapses
   multi-row/merged headers into real names).
2. **Trigger:** tiered/automatic — heuristic first, AI only on low confidence.
3. **Gating:** all plans, no extra gate; system cost, not chat tokens.
4. **Apply mode:** auto-apply; override via the existing re-ingest control.
5. **Persistence:** persist the AI plan per dataset (pay the API once).

## Resolution precedence (per sheet / CSV, in the worker)

Evaluated on the cheap peek (`header=None, nrows=HEADER_SCAN_ROWS`):

1. **Manual override** — `datasets.header_offset` is not NULL → read with
   `header=header_offset`. No heuristic, no AI, no plan use.
2. **Persisted plan** — `datasets.header_plan[sheet_key]` exists → reuse it
   (apply `data_start_row` + `columns`, no AI call).
3. **Heuristic** — compute `detect_header_offset(peek)` → offset `h`.
   - If `should_escalate(peek, h)` is false → apply `header=h` (current
     behavior).
   - If true AND the Anthropic client is available → call
     `header_ai.propose_header(peek_rows, sheet_key)`. On a valid plan →
     apply it and stage it for persistence. On `None` (unavailable / failure /
     invalid) → fall back to `header=h`.

`sheet_key` is the worksheet title for multi-sheet workbooks, and the sentinel
`"__file__"` for CSV and the legacy first-sheet path.

After all sheets are read, if any AI plans were produced, one
`UPDATE datasets SET header_plan = :plan` writes the merged jsonb (heuristic /
manual sheets get no entry — re-running the cheap heuristic on them is fine).

## Component 1 — confidence gate (pure, `services/profile.py`)

```
header_confidence(peek: pd.DataFrame, offset: int) -> float
```
Returns the fraction of the candidate header row's cells that are non-null,
unique, and string — i.e. how "header-like" the chosen row is. Row 0 of the
Ahmedabad sample (one filled cell of six) scores ~0.17.

```
should_escalate(peek: pd.DataFrame, offset: int, threshold: float = 0.7) -> bool
```
True when `header_confidence < threshold` (and the frame has ≥2 rows). Pure and
unit-tested.

## Component 2 — AI proposer (`services/header_ai.py`, new)

```
@dataclass
class HeaderPlan:
    data_start_row: int       # 0-based index of the first DATA row
    columns: list[str]        # one sanitized name per column

def propose_header(peek_rows: list[list[Any]], sheet_key: str) -> HeaderPlan | None
```

- Renders `peek_rows` as a compact indexed grid in the user message.
- Calls `client().messages.create(model=HEADER_MODEL, max_tokens=HEADER_MAX_TOKENS,
  system=..., tools=[REPORT_HEADER_TOOL], tool_choice={"type":"tool",
  "name":"report_header"}, messages=[...])`. A **forced single tool** with
  `input_schema {data_start_row: integer, columns: array<string>}` guarantees
  structured output (mirrors `chat_agent`'s tool pattern).
- Parses the `tool_use` block, then **validates**: `0 <= data_start_row <
  len(peek_rows)` and `len(columns) == n_cols` (the peek's column count).
- **Sanitizes** names: strip, collapse internal whitespace/newlines to single
  spaces, strip control chars, cap length (128), empty → `column_{i}`, dedupe
  case-insensitively via `name`, `name 2`, `name 3`. Sanitization is a separate
  pure function `sanitize_columns(names, n_cols) -> list[str]` (unit-tested).
- Returns `HeaderPlan` or `None` (missing key, API error/timeout, malformed or
  invalid output). All exceptions are swallowed and logged — `propose_header`
  never raises, mirroring `overview.generate_overview`.

System prompt (essence): "You are given the first rows of a spreadsheet as an
indexed grid. Identify the 0-based index of the first row that contains DATA
(not titles, notes, or header labels), and return one short, unique,
human-readable column name per column, inferring names from the header
row(s) above the data. Never invent columns; return exactly N names."

## Component 3 — model config (`services/anthropic_client.py`)

Add:
```python
HEADER_MODEL = os.getenv("ANTHROPIC_HEADER_MODEL", "claude-haiku-4-5-20251001")
HEADER_MAX_TOKENS = 1024
```
Haiku 4.5 — cheap, fast, sufficient for this structured extraction. Reuses the
existing `client()` singleton and its graceful "no key → ValueError → skip".

## Component 4 — worker application (`services/ingest.py`)

`read_sheet(sheet)` and the CSV branch gain the precedence logic above. Two
apply paths:
- **Offset path** (manual / heuristic): `read_excel(sheet, header=h)` /
  `read_csv(header=h)` — unchanged.
- **Plan path** (AI / persisted): read full with `header=None`, then
  `df = raw.iloc[data_start_row:].reset_index(drop=True)`, **re-validate**
  `df.shape[1] == len(columns)` (a persisted plan could mismatch if the file
  changed) — on mismatch fall back to the heuristic and drop the stale entry —
  then `df.columns = columns`.

The `_sheet` tagging, multi-sheet union, `no_common_columns` guard, and
`normalize_for_parquet` all run afterward, unchanged. `ingest_dataset` reads
`header_plan` from the bootstrap row alongside `header_offset`, threads both
into `_read_to_frame`, and writes back any newly-produced AI plans.

## Component 5 — data model + endpoint

**Migration** (`apps/api/alembic/versions/`): `ALTER TABLE datasets ADD COLUMN
header_plan JSONB` (nullable). NULL = no AI plan. Shape:
`{ "<sheet_key>": {"data_start_row": int, "columns": [str, ...]}, ... }`.

**Re-ingest endpoint** (`routers/datasets.py`): the existing `reingest` UPDATE
also sets `header_plan = NULL`. An explicit user re-ingest means "redo from
scratch": a manual offset supersedes AI; an auto (null-offset) re-ingest
re-runs heuristic + AI fresh. The persisted plan is therefore reused only by
non-user re-ingestion paths (e.g. sheet sync) and guarantees the first-ingest
columns are recorded.

## Error handling (never blocks ingest)

- No `ANTHROPIC_API_KEY` → `client()` raises ValueError → `propose_header`
  returns None → heuristic.
- API error / timeout / rate limit → caught → None → heuristic.
- Invalid AI output (range, count mismatch, empty) → None → heuristic.
- Sanitization always runs on AI names, so nothing unsafe reaches
  `dataset_columns` or DuckDB identifiers (which are still double-quote-escaped
  at query build time per invariant 3).
- Privacy: the top ≤20 rows are sent to Anthropic, consistent with the existing
  chat/overview data sampling. Documented, not gated.

## Testing

Pure unit tests (the risky logic), runnable via `/tmp/ingest-venv`:
- `header_confidence` / `should_escalate` on synthetic peeks (clean → no
  escalate; Ahmedabad-shaped → escalate).
- `sanitize_columns`: dedupe (case-insensitive), empty → `column_{i}`, length
  cap, control-char/newline stripping, count enforcement.
- `propose_header` response parsing: feed a **fake `tool_use` block** (monkey-
  patched client) and assert it yields a valid `HeaderPlan`; feed malformed /
  out-of-range / count-mismatch blocks and assert `None`.

The live AI call and the worker end-to-end are integration → manual smoke on
the running stack (re-upload the Ahmedabad workbook, confirm AI-cleaned column
names and a sensible `data_start_row`).

## Known limitations (honest)

- Multi-sheet: AI runs per sheet; differently-cleaned names across sheets could
  misalign the outer union (an existing messy-multi-sheet risk;
  `no_common_columns` still guards total disjointness).
- A fresh AI re-run can rename columns slightly differently; a re-ingest that
  leaves a customized dashboard intact may orphan widgets (same caveat as the
  header-offset feature — widgets fail gracefully via column allowlisting).
- Haiku can still be wrong on pathological layouts; the manual `header_offset`
  override remains the deterministic escape hatch.
