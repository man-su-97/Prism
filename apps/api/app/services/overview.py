"""Generate a one-paragraph dataset overview via Claude with prompt caching.

The schema + sample + summary stats block is sent as a cached prefix so that
later chat-agent calls (Phase 6) hit the cache.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.services.anthropic_client import DEFAULT_MODEL, OVERVIEW_MAX_TOKENS, client

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You write short, plain-English overviews of business datasets. "
    "Two to four sentences. Mention the entity captured per row, the time span "
    "if datetime columns exist, and one or two notable patterns from the stats. "
    "Never invent values that aren't in the supplied schema or stats."
)


def _format_schema(columns: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for c in columns:
        bits = [f"- {c['name']} :: {c['kind']} ({c['dtype']})"]
        if c.get("distinct_count") is not None:
            bits.append(f"distinct={c['distinct_count']}")
        if c.get("null_count"):
            bits.append(f"nulls={c['null_count']}")
        if c.get("min_value") is not None:
            bits.append(f"min={c['min_value']}")
        if c.get("max_value") is not None:
            bits.append(f"max={c['max_value']}")
        if c.get("sample"):
            bits.append(f"sample={c['sample'][:3]}")
        lines.append(" ".join(bits))
    return "\n".join(lines)


def generate_overview(
    dataset_name: str,
    row_count: int | None,
    columns: list[dict[str, Any]],
) -> str | None:
    """Return the overview text, or None if generation is unavailable."""
    try:
        c = client()
    except ValueError:
        logger.info("anthropic key missing; skipping overview")
        return None

    schema_block = _format_schema(columns)
    summary = {
        "dataset_name": dataset_name,
        "row_count": row_count,
        "column_count": len(columns),
    }

    try:
        resp = c.messages.create(
            model=DEFAULT_MODEL,
            max_tokens=OVERVIEW_MAX_TOKENS,
            system=_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Dataset metadata (cacheable, reused by the chat agent later):\n"
                                + json.dumps(summary, indent=2)
                                + "\n\nColumn schema and stats:\n"
                                + schema_block
                            ),
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": "Write the overview paragraph now.",
                        },
                    ],
                }
            ],
        )
    except Exception as exc:
        logger.warning("overview generation failed: %s", exc)
        return None

    parts: list[str] = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    text = "".join(parts).strip()
    return text or None
