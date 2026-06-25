from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.deps.auth import Principal, principal, tenant_session
from app.deps.limits import current_plan
from app.services import cache, chat_tokens, rate_limit
from app.services.chat_agent import AgentContext, run_agent
from app.services.duck import view_for_dataset
from app.services.plans import Plan

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])
settings = get_settings()


class ChatMessageOut(BaseModel):
    id: str
    role: str
    content: str
    tool_calls: list[dict[str, Any]] = []
    widget_id: str | None = None
    created_at: str


class ChatPostBody(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


async def _ensure_session(
    session: AsyncSession, p: Principal, dashboard_id: uuid.UUID
) -> uuid.UUID:
    existing = (
        await session.execute(
            text(
                "SELECT id FROM chat_sessions "
                "WHERE dashboard_id = :d AND user_id = :u"
            ),
            {"d": dashboard_id, "u": p.user_id},
        )
    ).first()
    if existing is not None:
        return existing.id
    row = (
        await session.execute(
            text(
                """
                INSERT INTO chat_sessions (org_id, dashboard_id, user_id)
                VALUES (:org, :d, :u)
                RETURNING id
                """
            ),
            {"org": p.org_id, "d": dashboard_id, "u": p.user_id},
        )
    ).one()
    return row.id


async def _load_history(
    session: AsyncSession, session_id: uuid.UUID
) -> list[dict[str, Any]]:
    res = await session.execute(
        text(
            "SELECT id, role, content, tool_calls_json, widget_id, created_at "
            "FROM chat_messages WHERE session_id = :sid ORDER BY created_at ASC"
        ),
        {"sid": session_id},
    )
    return [
        {
            "id": str(r.id),
            "role": r.role,
            "content": r.content or "",
            "tool_calls": r.tool_calls_json or [],
            "widget_id": str(r.widget_id) if r.widget_id else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in res
    ]


async def _load_agent_context(
    session: AsyncSession, dashboard_id: uuid.UUID, p: Principal
) -> AgentContext:
    dash = (
        await session.execute(
            text("SELECT id, dataset_id FROM dashboards WHERE id = :id"),
            {"id": dashboard_id},
        )
    ).first()
    if dash is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dashboard_not_found")

    ds = (
        await session.execute(
            text("SELECT id, name, row_count FROM datasets WHERE id = :id"),
            {"id": dash.dataset_id},
        )
    ).first()
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset_not_found")

    cols_res = await session.execute(
        text(
            "SELECT name, position, kind, dtype, distinct_count, "
            "min_value, max_value, sample FROM dataset_columns "
            "WHERE dataset_id = :id ORDER BY position"
        ),
        {"id": dash.dataset_id},
    )
    columns = [
        {
            "name": c.name,
            "position": c.position,
            "kind": c.kind,
            "dtype": c.dtype,
            "distinct_count": c.distinct_count,
            "min_value": c.min_value,
            "max_value": c.max_value,
            "sample": c.sample or [],
        }
        for c in cols_res
    ]

    return AgentContext(
        org_id=p.org_id,
        user_id=p.user_id,
        dashboard_id=dashboard_id,
        dataset_id=ds.id,
        dataset_name=ds.name,
        row_count=ds.row_count,
        columns=columns,
        view_name=view_for_dataset(ds.id),
    )


@router.delete("/{dashboard_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    dashboard_id: uuid.UUID,
    message_id: uuid.UUID,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> Response:
    session_id = await _ensure_session(session, p, dashboard_id)
    res = await session.execute(
        text(
            "DELETE FROM chat_messages "
            "WHERE id = :mid AND session_id = :sid"
        ),
        {"mid": message_id, "sid": session_id},
    )
    if res.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "message_not_found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{dashboard_id}", response_model=list[ChatMessageOut])
async def list_messages(
    dashboard_id: uuid.UUID,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> list[ChatMessageOut]:
    session_id = await _ensure_session(session, p, dashboard_id)
    rows = await _load_history(session, session_id)
    return [
        ChatMessageOut(
            id=r["id"],
            role=r["role"],
            content=r["content"],
            tool_calls=r["tool_calls"],
            widget_id=r["widget_id"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


def _sse(event: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(event, default=str)}\n\n".encode()


@router.post("/{dashboard_id}")
async def post_message(
    dashboard_id: uuid.UUID,
    body: ChatPostBody,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
    plan: Plan = Depends(current_plan),
) -> StreamingResponse:
    # Rate limit per org, scaled to the org's plan.
    rl = await rate_limit.check(p.org_id, scope="chat", limit=plan.chat_per_hour)
    if not rl.allowed:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limited",
                "retry_after_seconds": rl.retry_after_seconds,
            },
        )

    # Monthly chat-token quota. Consumes one token atomically; period rollover
    # is handled inside the same UPDATE. Committed before the agent runs so a
    # mid-stream disconnect can't refund the cost.
    token = await chat_tokens.check_and_consume(session, p.org_id, plan)
    if not token.allowed:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "chat_tokens_exhausted",
                "limit": token.status.cap,
                "reset_at": token.status.period_end.isoformat(),
            },
        )

    # check_and_consume commits, which clears `app.org_id` / `app.user_id`
    # (set with `set_config(..., is_local=true)` by tenant_session). Re-apply
    # them so the rest of this request still satisfies RLS — without this,
    # _ensure_session's INSERT on chat_sessions fails the WITH CHECK clause.
    await session.execute(
        text("SELECT set_config('app.org_id', :org, true)"), {"org": p.org_id}
    )
    await session.execute(
        text("SELECT set_config('app.user_id', :uid, true)"), {"uid": p.user_id}
    )

    session_id = await _ensure_session(session, p, dashboard_id)
    history = await _load_history(session, session_id)
    ctx = await _load_agent_context(session, dashboard_id, p)

    # Persist the user message immediately so it shows up on the next GET.
    user_msg_row = (
        await session.execute(
            text(
                """
                INSERT INTO chat_messages (org_id, session_id, role, content)
                VALUES (:org, :sid, 'user', :content)
                RETURNING id, created_at
                """
            ),
            {"org": p.org_id, "sid": session_id, "content": body.message},
        )
    ).one()
    user_message_id = str(user_msg_row.id)

    # Commit explicitly: the SSE generator runs after this function returns
    # and can't rely on the tenant_session context manager committing for it.
    await session.commit()

    # Engine for the worker tools — sync, because pandas/duckdb are sync.
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg")
    sync_engine = sa.create_engine(sync_url, pool_pre_ping=True, future=True)

    async def event_stream() -> AsyncIterator[bytes]:
        yield _sse({"type": "user_message_id", "id": user_message_id})
        yield _sse(
            {
                "type": "tokens_status",
                "used": token.status.used,
                "remaining": token.status.remaining,
                "cap": token.status.cap,
                "period_end": token.status.period_end.isoformat(),
            }
        )

        assistant_text_parts: list[str] = []
        tool_calls_record: list[dict[str, Any]] = []
        created_widget: str | None = None
        updated_widget: str | None = None

        try:
            async for event in run_agent(ctx, sync_engine, history, body.message):
                if event["type"] == "text_delta":
                    assistant_text_parts.append(event["text"])
                elif event["type"] == "final_answer":
                    assistant_text_parts = [event["text"]]
                elif event["type"] == "tool_call":
                    tool_calls_record.append(
                        {"name": event["name"], "input": event.get("input", {})}
                    )
                elif event["type"] == "tool_result":
                    if tool_calls_record:
                        tool_calls_record[-1]["output"] = event.get("output")
                        tool_calls_record[-1]["ok"] = event.get("ok", False)
                elif event["type"] == "widget_created":
                    created_widget = event.get("widget_id")
                    await cache.bust_widget(uuid.UUID(created_widget))
                elif event["type"] == "widget_updated":
                    updated_widget = event.get("widget_id")
                    await cache.bust_widget(uuid.UUID(updated_widget))

                yield _sse(event)
                # Force a flush opportunity on slow clients.
                await asyncio.sleep(0)
        except Exception as exc:
            logger.exception("chat stream crashed")
            yield _sse({"type": "error", "error": str(exc)})

        # Persist the assistant turn using a fresh DB session — the dep's
        # session is no longer valid here.
        try:
            from app.db import SessionFactory

            async with SessionFactory() as persist:
                await persist.execute(
                    text("SELECT set_config('app.org_id', :org, true)"),
                    {"org": p.org_id},
                )
                final_text = "".join(assistant_text_parts).strip()
                widget_link = created_widget or updated_widget
                row = (
                    await persist.execute(
                        text(
                            """
                            INSERT INTO chat_messages
                              (org_id, session_id, role, content, tool_calls_json, widget_id)
                            VALUES
                              (:org, :sid, 'assistant', :content,
                               CAST(:tools AS jsonb), :widget)
                            RETURNING id
                            """
                        ),
                        {
                            "org": p.org_id,
                            "sid": session_id,
                            "content": final_text or "",
                            "tools": json.dumps(tool_calls_record, default=str),
                            "widget": widget_link,
                        },
                    )
                ).one()
                await persist.commit()
                yield _sse({"type": "assistant_message_id", "id": str(row.id)})
        except Exception:
            logger.exception("failed to persist assistant message")

        yield _sse({"type": "stream_closed"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
