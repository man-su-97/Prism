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
    stripped; over-long names are capped at 128 chars (including any dedupe
    suffix); empties become `column_{i+1}`; and case-insensitive duplicates
    (whether from the input or generated) get a numeric suffix until unique.
    AI names flow into dataset_columns and DuckDB identifiers, so this is the
    safety boundary — the output is guaranteed to have no two case-insensitively
    equal names.
    """
    out: list[str] = []
    used: set[str] = set()
    for i in range(n_cols):
        raw = names[i] if i < len(names) else ""
        base = "" if raw is None else str(raw)
        base = re.sub(r"\s+", " ", base).strip()
        base = "".join(ch for ch in base if ch.isprintable())
        base = base[:_MAX_NAME_LEN]
        if not base:
            base = f"column_{i + 1}"
        name = base
        n = 1
        while name.casefold() in used:
            n += 1
            suffix = f" {n}"
            name = base[: _MAX_NAME_LEN - len(suffix)] + suffix
        used.add(name.casefold())
        out.append(name)
    return out


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
    except Exception:
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
    except Exception:
        logger.exception("AI header detection call failed for sheet %s", sheet_key)
        return None
    tool_input = _extract_tool_input(resp, "report_header")
    return _plan_from_tool_input(tool_input, n_cols, len(peek_rows))
