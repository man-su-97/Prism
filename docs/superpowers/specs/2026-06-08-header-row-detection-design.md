# Header-row detection — design

**Date:** 2026-06-08
**Status:** approved (pending spec review)
**Context:** Follow-up to the ingest crash-fix (`normalize_for_parquet`). Messy
spreadsheets often place title/preamble rows above the real header, so
pandas' default `header=0` picks a title as column names and the whole table
profiles as junk. This adds automatic header-row detection with a manual
override + re-ingest.

## Goals / non-goals

**Goals**
- Automatically skip leading preamble/title rows when a file has one clean
  header row beneath them — for both Excel (per worksheet) and CSV.
- Let the user manually correct the header position and re-ingest when the
  guess is wrong (or absent).
- Never crash, never silently pick a *wrong* header on clean files.

**Non-goals**
- Multi-row / merged-cell header reconstruction (e.g. the
  `Ahmedabad Safe City Queries.xlsx` sample, whose header spans rows 1/3/4).
  Detection deliberately **no-ops** on such files (returns offset 0); the
  crash-fix keeps them ingestible and the manual override is the escape hatch.
- Per-sheet *manual* override. Auto-detection is per-sheet; the manual
  override is a single global integer (YAGNI for per-sheet JSON).

## Decisions (from brainstorming)

1. **UX:** automatic on ingest, with a manual override + re-ingest later
   (no upload-time picker).
2. **Scope:** Excel **and** CSV.
3. **Multi-sheet:** auto-detect runs per worksheet; manual override is one
   global integer applied to all sheets/CSV.
4. **Re-ingest + dashboard:** regenerate the starter dashboard only if it is
   **untouched**, tracked by an explicit `dashboards.customized` flag.
5. **Sequencing:** single combined plan (detection + worker + migration +
   endpoint + dashboard guard + web UI).

## Component 1 — detection heuristic (pure function)

`detect_header_offset(raw_df: pd.DataFrame, max_scan: int = 20) -> int` in
`apps/api/app/services/profile.py` (pandas-only, beside `normalize_for_parquet`).

Input is the first `max_scan` rows read with `header=None` (every row is data,
columns are positional). Returns the 0-based index of the detected header row;
rows above it are skipped. Returns `0` when no row is a *confident* header.

For each candidate row `r` (with at least one row below it), compute over the
row's cells:
- `fill = non_null / n_cols`
- `string_ratio = strings / non_null`
- `unique_ratio = distinct_non_null / non_null`
- `below_fill = median(fill of next min(5, remaining) rows)`

Row `r` **qualifies** iff all hold:
- `fill >= 0.5` (not a sparse title/blank row)
- `string_ratio >= 0.8` (headers are text labels)
- `unique_ratio >= 0.9` (headers don't repeat)
- `below_fill >= 0.5` (there is real data beneath)
- `fill >= 0.9 * below_fill` (header is about as populated as its data)

Return the **first** qualifying `r` (preamble is always above the header). If
row 0 qualifies, return 0 immediately (fast path for clean files). If `len < 2`
or nothing qualifies, return 0.

**Verified against the sample:** rows 0–4 are sparse relative to the 6/6 data
rows and the data rows carry numbers/duplicates, so none qualify → returns 0
(no false guess).

*Alternatives rejected:* "first fully-dense row = header" (eats the first data
row on files like the sample); statistical/ML (overkill).

## Component 2 — worker wiring

`_read_to_frame(local, source_kind, worksheet_names, header_offset)` in
`services/ingest.py` gains `header_offset: int | None`:

- `header_offset is None` → **auto** mode:
  - CSV: `pd.read_csv(local, header=None, nrows=max_scan)` → `detect_header_offset`
    → re-read chunked with `header=r`.
  - Excel: for each worksheet, `pd.read_excel(local, sheet_name=name,
    header=None, nrows=max_scan)` → detect → re-read that sheet with `header=r`.
    (Legacy single-sheet path — `worksheet_names IS NULL` — detects on the
    first sheet.)
- `header_offset = N` (non-null) → **forced global**: use `header=N` for CSV
  and every worksheet; skip detection.

Re-reading with the resolved `header=` (rather than slicing the `header=None`
object frame) preserves pandas' per-column dtype inference. `_sheet` tagging,
the multi-sheet `no_common_columns` guard, the union, and `normalize_for_parquet`
all run unchanged afterward.

`ingest_dataset` reads `header_offset` from the dataset row (added to the
bootstrap `SELECT`) and passes it through.

## Component 3 — data model + re-ingest

**Migration** (`apps/api/alembic/versions/`):
- `ALTER TABLE datasets ADD COLUMN header_offset INTEGER` (nullable; `NULL` =
  auto). No RLS change (existing table).
- `ALTER TABLE dashboards ADD COLUMN customized BOOLEAN NOT NULL DEFAULT false`.
  Existing rows backfill to `false` (treated as untouched — acceptable; the
  next mutation flips them).

**`dashboards.customized` flag** flips to `true` on any user mutation of the
dashboard:
- `PATCH /api/dashboards/{id}` (layout/name save) → set `customized = true`.
- widget create / update / delete under the dashboard → set the parent
  dashboard's `customized = true`.

This is deterministic, unlike sniffing `layout_json` id-shapes (which misses
wizard-only config edits).

**`POST /api/datasets/{id}/reingest`** body `{header_offset: int | null}`
(`Field(ge=0, le=100)` or null), deps `tenant_session` + `current_plan` (no new
capacity — same dataset/parquet/object_key):
- refuse `dataset_busy` (409) if status in `pending|uploading|ingesting`.
- set `header_offset`, `status='pending'`, `error=NULL`, `updated_at=NOW()`.
- enqueue the ingest Arq job for the dataset id; return 202 with status.

**Dashboard-duplication guard in `ingest_dataset`:** today `_build_starter_dashboard`
runs on *every* ingest, so re-ingest would create a second auto dashboard.
New behavior at the end of ingest:
- Count this dataset's dashboards.
- If **zero** → build the starter dashboard (first ingest, unchanged).
- If exactly **one** with `kind='auto'` and `customized = false` → drop it
  (and its widgets; bust each widget cache) and rebuild from the new schema
  ("regenerate if untouched").
- Otherwise → leave dashboards intact. Parquet + `dataset_columns` are still
  overwritten; widgets referencing a now-renamed column fail gracefully via the
  existing column-allowlist validation (humanized error), not a crash.

## Component 4 — web UI

Dataset detail page (`apps/web/app/(app)/datasets/[id]/`): a small "Header row"
control showing `Auto-detected` (when `header_offset IS NULL`) or `Row N`, with
a number input + "Re-ingest" button POSTing to `/api/datasets/{id}/reingest`
through the Next.js proxy. Reflects the `ingesting` status after submit. Uses
the existing error pipeline (`parseApiError` / `buildApiError` +
`ERROR_DICTIONARY`); `dataset_busy` already maps to friendly copy. Add a
`reingesting`/`header_offset` field to the dataset detail type next to the
server route that produces it.

## Error handling

- Detection never throws: wrapped so any unexpected shape falls back to
  offset 0 (current behavior).
- Re-ingest on a busy dataset → `dataset_busy` 409 (existing code).
- Forced offset past the data (`header=N` with no rows below) → pandas yields
  an empty frame; ingest proceeds and the dataset reports `row_count=0` rather
  than erroring (the user can re-ingest with a corrected value).

## Testing

Pure unit tests (pandas-only, no app/env import) in `apps/api/tests/`:
- `detect_header_offset`: clean header at row 0 → 0; title+blank+header+data
  → header row index; all-sparse-or-numeric (sample shape) → 0; `< 2` rows → 0;
  forced/short frames.
- Regression: read the real `test/Ahmedabad Safe City Queries.xlsx`, assert
  `detect_header_offset` returns 0 and the normalized frame still writes to
  parquet (extends the existing `test_profile_normalize.py` coverage).

Endpoint/worker integration tests are out of scope for this plan (the repo has
no Postgres test fixture yet); the heuristic — the risky part — is fully
unit-covered.
