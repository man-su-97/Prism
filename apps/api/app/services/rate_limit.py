"""Per-org rate limiting for the chat endpoint.

Sliding-window counter implemented with Redis INCR + EXPIRE on a per-hour key.
Cheap and good enough for Phase 6's 30 req/hour cap; Phase 8 may replace this
with a token-bucket if needed.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import redis.asyncio as redis

from app.services.cache import client as redis_client

logger = logging.getLogger(__name__)

CHAT_LIMIT_PER_HOUR = 30
WINDOW_SECONDS = 60 * 60


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_seconds: int


def _bucket_key(org_id: str, scope: str, now: int) -> str:
    window = now // WINDOW_SECONDS
    return f"rl:{scope}:{org_id}:{window}"


async def check(org_id: str, *, scope: str = "chat", limit: int | None = None) -> RateLimitResult:
    cap = limit if limit is not None else CHAT_LIMIT_PER_HOUR
    now = int(time.time())
    key = _bucket_key(org_id, scope, now)
    try:
        c: redis.Redis = redis_client()
        pipe = c.pipeline()
        pipe.incr(key)
        pipe.expire(key, WINDOW_SECONDS)
        results = await pipe.execute()
        used = int(results[0])
    except redis.RedisError as exc:
        logger.warning("rate limit redis error; failing open: %s", exc)
        return RateLimitResult(allowed=True, remaining=cap, retry_after_seconds=0)

    if used > cap:
        seconds_into_window = now % WINDOW_SECONDS
        return RateLimitResult(
            allowed=False,
            remaining=0,
            retry_after_seconds=max(1, WINDOW_SECONDS - seconds_into_window),
        )
    return RateLimitResult(allowed=True, remaining=max(0, cap - used), retry_after_seconds=0)
