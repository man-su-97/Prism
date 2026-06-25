"""Monthly chat-token quota.

One user chat message = one token. The quota is per workspace (org), stored
on the existing `subscriptions` row so plan tier, billing period, and
remaining tokens stay in one place.

Reset semantics:
- Paid plans: `chat_tokens_period_end` tracks Stripe `current_period_end`,
  reset by `services/billing._apply_subscription` on plan change or period
  rollover.
- Free plans: 30-day rolling window. The first message after `period_end`
  passes auto-bumps both the counter and the window in the same atomic
  UPDATE (see `check_and_consume`), so there's no scheduled job to run.

Both paths share the same enforcement code below.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.plans import Plan


@dataclass(frozen=True)
class ChatTokenStatus:
    used: int
    remaining: int
    cap: int
    period_end: datetime


@dataclass(frozen=True)
class ChatTokenResult:
    allowed: bool
    status: ChatTokenStatus


def _remaining(used: int, cap: int) -> int:
    return max(0, cap - used)


async def check_and_consume(
    session: AsyncSession, org_id: str, plan: Plan
) -> ChatTokenResult:
    """Atomically consume one chat token if the org has budget.

    The single UPDATE handles three cases in one round-trip:
    1. Period elapsed → reset counter to 1, bump period_end forward.
    2. Period live, under cap → increment counter.
    3. Period live, at cap → WHERE clause fails, no row returned → blocked.

    Returns the post-consume status. When blocked, `allowed=False` and
    `status` reflects the *unchanged* row (so callers can surface
    `period_end` to clients).
    """
    cap = plan.chat_tokens_per_month
    res = await session.execute(
        text(
            """
            UPDATE subscriptions
            SET
              chat_tokens_used = CASE
                WHEN chat_tokens_period_end IS NULL OR chat_tokens_period_end <= NOW()
                  THEN 1
                ELSE chat_tokens_used + 1
              END,
              chat_tokens_period_end = CASE
                WHEN chat_tokens_period_end IS NULL OR chat_tokens_period_end <= NOW()
                  THEN COALESCE(current_period_end, NOW() + INTERVAL '30 days')
                ELSE chat_tokens_period_end
              END
            WHERE org_id = :org
              AND (
                chat_tokens_period_end IS NULL
                OR chat_tokens_period_end <= NOW()
                OR chat_tokens_used < :cap
              )
            RETURNING chat_tokens_used, chat_tokens_period_end
            """
        ),
        {"org": org_id, "cap": cap},
    )
    row = res.first()
    if row is not None:
        await session.commit()
        return ChatTokenResult(
            allowed=True,
            status=ChatTokenStatus(
                used=row.chat_tokens_used,
                remaining=_remaining(row.chat_tokens_used, cap),
                cap=cap,
                period_end=row.chat_tokens_period_end,
            ),
        )

    # Blocked. Read the current (unchanged) status to surface period_end.
    status = await get_status(session, org_id, plan)
    return ChatTokenResult(allowed=False, status=status)


async def get_status(
    session: AsyncSession, org_id: str, plan: Plan
) -> ChatTokenStatus:
    """Read-only view of the org's current quota state.

    If the period has elapsed, reports `used=0, remaining=cap` with the
    upcoming reset_at (consume() will roll the row on the next send). If
    there's no `subscriptions` row yet, returns a fresh-quota snapshot
    anchored 30 days out so the UI has something to show.
    """
    cap = plan.chat_tokens_per_month
    row = (
        await session.execute(
            text(
                "SELECT chat_tokens_used, chat_tokens_period_end "
                "FROM subscriptions WHERE org_id = :org"
            ),
            {"org": org_id},
        )
    ).first()
    if row is None:
        return ChatTokenStatus(
            used=0,
            remaining=cap,
            cap=cap,
            period_end=datetime.now(tz=UTC) + timedelta(days=30),
        )
    period_end = row.chat_tokens_period_end
    now = datetime.now(tz=UTC)
    if period_end is None or period_end <= now:
        # Window has rolled or never set — consume() will fix on next send.
        return ChatTokenStatus(
            used=0,
            remaining=cap,
            cap=cap,
            period_end=period_end or (now + timedelta(days=30)),
        )
    return ChatTokenStatus(
        used=row.chat_tokens_used,
        remaining=_remaining(row.chat_tokens_used, cap),
        cap=cap,
        period_end=period_end,
    )
