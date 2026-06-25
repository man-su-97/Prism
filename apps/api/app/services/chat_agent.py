"""Claude tool-use loop for dashboard chat.

Five tools:
- run_sql(sql): execute a read-only DuckDB query, capped at 1000 rows
- propose_chart(spec): validate a widget spec without persisting
- add_widget(spec, position?): persist a new widget
- update_widget(widget_id, spec): patch an existing widget's config/title/kind
- final_answer(text, attachments?): terminal message rendered to the user

The loop:
- step cap of MAX_TOOL_TURNS tool calls
- prompt caching on the dataset metadata block so follow-ups hit the cache
- yields structured events suitable for SSE streaming
"""
from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy import text

from app.services.anthropic_client import DEFAULT_MODEL, client
from app.services.duck import UnsafeSQLError, open_org_connection, run_query
from app.services.plans import get_plan
from app.services.widget_builder import BuilderError, build_widget_config

logger = logging.getLogger(__name__)

MAX_TOOL_TURNS = 6
MAX_TOKENS = 1600
MAX_HISTORY_MESSAGES = 12  # excluding the cached system block

_SYSTEM = (
    "You are Prism's analytics co-pilot. You help users explore one "
    "dataset and one dashboard via tools. Conventions:\n"
    "- ALWAYS call `run_sql` with a single SELECT/WITH statement before quoting a number.\n"
    "- When the user asks to add or modify a chart, call `add_widget` or `update_widget` "
    "  with the structured spec; do NOT free-form SQL the dashboard.\n"
    "- Use `propose_chart` first if you're unsure a config will validate.\n"
    "- Wrap up with `final_answer`. Be concise; lead with the answer.\n"
    "- SQL must reference only the registered view `__VIEW__`. No file paths, no ATTACH.\n"
)


@dataclass
class AgentContext:
    org_id: str
    user_id: str
    dashboard_id: uuid.UUID
    dataset_id: uuid.UUID
    dataset_name: str
    row_count: int | None
    columns: list[dict[str, Any]]
    view_name: str  # ds_<uuid-underscored>


@dataclass
class ToolEvent:
    name: str
    input: dict[str, Any]
    output: Any
    ok: bool
    widget_id: str | None = None


@dataclass
class AgentTurn:
    text: str = ""
    tool_events: list[ToolEvent] = field(default_factory=list)
    created_widget_ids: list[str] = field(default_factory=list)
    updated_widget_ids: list[str] = field(default_factory=list)
    stop_reason: str = "ok"


TOOLS = [
    {
        "name": "run_sql",
        "description": (
            "Execute a single read-only SELECT/WITH query against the dataset view. "
            "Returns up to 1000 rows. Use the registered view name supplied in the system block."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"sql": {"type": "string"}},
            "required": ["sql"],
        },
    },
    {
        "name": "propose_chart",
        "description": (
            "Validate a widget spec without persisting it. Use when unsure that a config "
            "will build cleanly. Returns the generated SQL if valid."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["kpi", "line", "bar", "pie", "table"]},
                "title": {"type": "string"},
                "x": {"type": "string"},
                "y": {"type": "string"},
                "aggregate": {"type": "string", "enum": ["COUNT", "SUM", "AVG", "MIN", "MAX"]},
                "label": {"type": "string"},
                "value": {"type": "string"},
                "time_bucket": {"type": "string", "enum": ["day", "week", "month", "quarter", "year"]},
                "limit": {"type": "integer"},
            },
            "required": ["kind", "title"],
        },
    },
    {
        "name": "add_widget",
        "description": "Persist a new widget on the current dashboard.",
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["kpi", "line", "bar", "pie", "table"]},
                "title": {"type": "string"},
                "x": {"type": "string"},
                "y": {"type": "string"},
                "aggregate": {"type": "string", "enum": ["COUNT", "SUM", "AVG", "MIN", "MAX"]},
                "label": {"type": "string"},
                "value": {"type": "string"},
                "time_bucket": {"type": "string", "enum": ["day", "week", "month", "quarter", "year"]},
                "limit": {"type": "integer"},
            },
            "required": ["kind", "title"],
        },
    },
    {
        "name": "update_widget",
        "description": "Patch an existing widget's kind/title/columns/aggregate.",
        "input_schema": {
            "type": "object",
            "properties": {
                "widget_id": {"type": "string", "description": "UUID of the widget to update."},
                "kind": {"type": "string", "enum": ["kpi", "line", "bar", "pie", "table"]},
                "title": {"type": "string"},
                "x": {"type": "string"},
                "y": {"type": "string"},
                "aggregate": {"type": "string", "enum": ["COUNT", "SUM", "AVG", "MIN", "MAX"]},
                "label": {"type": "string"},
                "value": {"type": "string"},
                "time_bucket": {"type": "string", "enum": ["day", "week", "month", "quarter", "year"]},
                "limit": {"type": "integer"},
            },
            "required": ["widget_id"],
        },
    },
    {
        "name": "final_answer",
        "description": "Terminal message rendered to the user. Always call this when done.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "widget_id": {"type": "string", "description": "Optional widget to link."},
            },
            "required": ["text"],
        },
    },
]


def _format_schema(columns: list[dict[str, Any]]) -> str:
    out = []
    for c in columns:
        bits = [f"- {c['name']} :: {c['kind']} ({c['dtype']})"]
        if c.get("distinct_count") is not None:
            bits.append(f"distinct={c['distinct_count']}")
        if c.get("min_value") is not None:
            bits.append(f"min={c['min_value']}")
        if c.get("max_value") is not None:
            bits.append(f"max={c['max_value']}")
        if c.get("sample"):
            bits.append(f"sample={c['sample'][:3]}")
        out.append(" ".join(bits))
    return "\n".join(out)


def _build_initial_user_block(ctx: AgentContext) -> dict[str, Any]:
    """Cached prefix shared across every turn of this session."""
    summary = {
        "dataset_name": ctx.dataset_name,
        "row_count": ctx.row_count,
        "view_name": ctx.view_name,
        "column_count": len(ctx.columns),
    }
    schema = _format_schema(ctx.columns)
    return {
        "type": "text",
        "text": (
            "Dataset metadata for this dashboard session:\n"
            + json.dumps(summary, indent=2)
            + "\n\nColumn schema:\n"
            + schema
        ),
        "cache_control": {"type": "ephemeral"},
    }


def _system_prompt(ctx: AgentContext) -> str:
    return _SYSTEM.replace("__VIEW__", ctx.view_name)


# --- Tool execution -------------------------------------------------------- #


def _run_sql(ctx: AgentContext, sql: str) -> dict[str, Any]:
    try:
        with open_org_connection(ctx.org_id) as conn:
            rows = run_query(conn, sql, limit=1000)
    except UnsafeSQLError as exc:
        return {"ok": False, "error": f"unsafe_sql: {exc}"}
    except Exception as exc:
        return {"ok": False, "error": f"sql_error: {exc}"}
    return {"ok": True, "row_count": len(rows), "rows": rows[:50]}


def _propose_chart(ctx: AgentContext, args: dict[str, Any]) -> dict[str, Any]:
    try:
        cfg = build_widget_config(
            ctx.dataset_id,
            ctx.columns,
            kind=args["kind"],
            title=args.get("title", "Untitled"),
            x=args.get("x"),
            y=args.get("y"),
            aggregate=args.get("aggregate"),
            label=args.get("label"),
            value=args.get("value"),
            time_bucket=args.get("time_bucket"),
            limit=int(args.get("limit") or 25),
        )
    except BuilderError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "config": cfg}


def _add_widget(
    ctx: AgentContext,
    sync_engine: sa.Engine,
    args: dict[str, Any],
) -> dict[str, Any]:
    try:
        cfg = build_widget_config(
            ctx.dataset_id,
            ctx.columns,
            kind=args["kind"],
            title=args.get("title", "Untitled"),
            x=args.get("x"),
            y=args.get("y"),
            aggregate=args.get("aggregate"),
            label=args.get("label"),
            value=args.get("value"),
            time_bucket=args.get("time_bucket"),
            limit=int(args.get("limit") or 25),
        )
    except BuilderError as exc:
        return {"ok": False, "error": str(exc)}

    _DEGRADED = ("canceled", "incomplete_expired", "unpaid")

    with sync_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": ctx.org_id})

        # Enforce plan widget cap — the REST endpoint does this too, but the
        # chat agent inserts directly and would otherwise bypass the limit.
        sub_row = conn.execute(
            text("SELECT plan, status FROM subscriptions WHERE org_id = :org"),
            {"org": ctx.org_id},
        ).first()
        plan_name = (
            sub_row.plan
            if sub_row is not None and sub_row.status not in _DEGRADED
            else "free"
        )
        org_plan = get_plan(plan_name)
        widget_count = conn.execute(
            text("SELECT COUNT(*)::int AS n FROM widgets WHERE dashboard_id = :d"),
            {"d": ctx.dashboard_id},
        ).one().n
        if widget_count >= org_plan.max_widgets_per_dashboard:
            return {"ok": False, "error": "widget_limit_reached"}

        row = conn.execute(
            text(
                """
                INSERT INTO widgets
                  (org_id, dashboard_id, dataset_id, kind, title, config_json)
                VALUES
                  (:org, :dash, :ds, :kind, :title, CAST(:config AS jsonb))
                RETURNING id
                """
            ),
            {
                "org": ctx.org_id,
                "dash": ctx.dashboard_id,
                "ds": ctx.dataset_id,
                "kind": args["kind"],
                "title": args.get("title", "Untitled"),
                "config": json.dumps(cfg),
            },
        ).one()
    return {"ok": True, "widget_id": str(row.id), "config": cfg}


def _update_widget(
    ctx: AgentContext,
    sync_engine: sa.Engine,
    args: dict[str, Any],
) -> dict[str, Any]:
    try:
        widget_uuid = uuid.UUID(args["widget_id"])
    except (KeyError, ValueError):
        return {"ok": False, "error": "bad_widget_id"}

    with sync_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": ctx.org_id})
        existing = conn.execute(
            text(
                "SELECT id, dashboard_id, dataset_id, kind, title, config_json "
                "FROM widgets WHERE id = :id"
            ),
            {"id": widget_uuid},
        ).first()
        if existing is None:
            return {"ok": False, "error": "widget_not_found"}
        # Prevent cross-dashboard mutation: a member who knows a widget UUID from
        # another dashboard could otherwise direct the agent to overwrite it.
        if str(existing.dashboard_id) != str(ctx.dashboard_id):
            return {"ok": False, "error": "widget_not_found"}
        if existing.kind == "overview":
            return {"ok": False, "error": "overview_not_editable"}

        cfg = dict(existing.config_json or {})
        kind = args.get("kind") or existing.kind
        title = args.get("title") or existing.title
        try:
            rebuilt = build_widget_config(
                existing.dataset_id,
                ctx.columns,
                kind=kind,
                title=title,
                x=args.get("x") if args.get("x") is not None else cfg.get("x"),
                y=args.get("y") if args.get("y") is not None else cfg.get("y"),
                aggregate=args.get("aggregate")
                if args.get("aggregate") is not None
                else cfg.get("aggregate"),
                label=args.get("label") if args.get("label") is not None else cfg.get("label"),
                value=args.get("value") if args.get("value") is not None else cfg.get("value"),
                time_bucket=args.get("time_bucket")
                if args.get("time_bucket") is not None
                else cfg.get("time_bucket"),
                limit=int(args.get("limit") or cfg.get("limit") or 25),
            )
        except BuilderError as exc:
            return {"ok": False, "error": str(exc)}

        conn.execute(
            text(
                """
                UPDATE widgets SET
                  kind = :kind, title = :title,
                  config_json = CAST(:config AS jsonb),
                  updated_at = NOW()
                WHERE id = :id
                """
            ),
            {
                "kind": kind,
                "title": title,
                "config": json.dumps(rebuilt),
                "id": widget_uuid,
            },
        )

    # Best-effort cache bust; we don't import async cache here to keep this sync.
    return {"ok": True, "widget_id": str(widget_uuid), "config": rebuilt}


# --- Public entrypoint ----------------------------------------------------- #


def run_agent(
    ctx: AgentContext,
    sync_engine: sa.Engine,
    history: list[dict[str, Any]],
    user_message: str,
) -> AsyncIterator[dict[str, Any]]:
    """Run the agent and yield SSE-friendly events.

    Returns an async iterator. Each item is one event dict the SSE writer
    serialises and pushes to the client.
    """
    return _run_agent(ctx, sync_engine, history, user_message)


async def _run_agent(
    ctx: AgentContext,
    sync_engine: sa.Engine,
    history: list[dict[str, Any]],
    user_message: str,
) -> AsyncIterator[dict[str, Any]]:
    try:
        anth = client()
    except ValueError:
        yield {"type": "error", "error": "ANTHROPIC_API_KEY is not configured."}
        yield {"type": "done"}
        return

    # Build the conversation context. The first user turn carries the cached
    # dataset block; subsequent history is appended as plain user/assistant.
    messages: list[dict[str, Any]] = []

    initial_block = _build_initial_user_block(ctx)
    messages.append({"role": "user", "content": [initial_block]})
    messages.append({
        "role": "assistant",
        "content": [{"type": "text", "text": "Got it — I have the dataset schema in context."}],
    })

    # Prior chat history (cap to MAX_HISTORY_MESSAGES exchanges).
    for h in history[-MAX_HISTORY_MESSAGES:]:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content:
            messages.append({"role": role, "content": [{"type": "text", "text": content}]})

    messages.append({"role": "user", "content": [{"type": "text", "text": user_message}]})

    turn = AgentTurn()
    final_text: str | None = None

    for _ in range(MAX_TOOL_TURNS + 1):
        try:
            resp = anth.messages.create(
                model=DEFAULT_MODEL,
                max_tokens=MAX_TOKENS,
                system=_system_prompt(ctx),
                tools=TOOLS,
                messages=messages,
            )
        except Exception as exc:
            logger.exception("anthropic call failed")
            yield {"type": "error", "error": f"model_error: {exc}"}
            break

        # Surface any inline text from the assistant turn.
        assistant_content: list[dict[str, Any]] = []
        tool_uses: list[dict[str, Any]] = []
        for block in resp.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                assistant_content.append({"type": "text", "text": block.text})
                if block.text.strip():
                    yield {"type": "text_delta", "text": block.text}
            elif btype == "tool_use":
                assistant_content.append(
                    {
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    }
                )
                tool_uses.append({"id": block.id, "name": block.name, "input": block.input})

        messages.append({"role": "assistant", "content": assistant_content})

        if not tool_uses:
            # No tool calls → the model is done talking. Treat trailing text as final.
            for block in assistant_content:
                if block.get("type") == "text" and block.get("text"):
                    final_text = block["text"]
            turn.stop_reason = resp.stop_reason or "end_turn"
            break

        # Execute every tool_use block in order.
        tool_results: list[dict[str, Any]] = []
        terminated = False
        for tu in tool_uses:
            name = tu["name"]
            args = tu["input"] if isinstance(tu["input"], dict) else {}
            yield {"type": "tool_call", "name": name, "input": args}

            if name == "run_sql":
                output = _run_sql(ctx, args.get("sql", ""))
            elif name == "propose_chart":
                output = _propose_chart(ctx, args)
            elif name == "add_widget":
                output = _add_widget(ctx, sync_engine, args)
                if output.get("ok") and output.get("widget_id"):
                    turn.created_widget_ids.append(output["widget_id"])
                    yield {"type": "widget_created", "widget_id": output["widget_id"]}
            elif name == "update_widget":
                output = _update_widget(ctx, sync_engine, args)
                if output.get("ok") and output.get("widget_id"):
                    turn.updated_widget_ids.append(output["widget_id"])
                    yield {"type": "widget_updated", "widget_id": output["widget_id"]}
            elif name == "final_answer":
                final_text = args.get("text", "")
                if args.get("widget_id"):
                    turn.created_widget_ids.append(str(args["widget_id"]))
                output = {"ok": True}
                terminated = True
            else:
                output = {"ok": False, "error": f"unknown_tool: {name}"}

            event = ToolEvent(
                name=name,
                input=args,
                output=output,
                ok=bool(output.get("ok", False)),
                widget_id=output.get("widget_id"),
            )
            turn.tool_events.append(event)
            yield {
                "type": "tool_result",
                "name": name,
                "ok": event.ok,
                "output": output,
            }
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": json.dumps(output, default=str),
                    "is_error": not event.ok,
                }
            )

        messages.append({"role": "user", "content": tool_results})

        if terminated:
            turn.stop_reason = "final_answer"
            break

    if final_text:
        turn.text = final_text
        yield {"type": "final_answer", "text": final_text}

    yield {
        "type": "done",
        "stop_reason": turn.stop_reason,
        "created_widget_ids": turn.created_widget_ids,
        "updated_widget_ids": turn.updated_widget_ids,
    }
