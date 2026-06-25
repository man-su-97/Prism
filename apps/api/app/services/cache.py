"""Tiny Redis-backed cache for widget data.

Key shape: `widget:{widget_id}:v{dataset_version}`. Bumping the dataset version
or invalidating the widget renders all old entries unreachable; we leave them
to TTL out (60 minutes) rather than enumerating.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any
from uuid import UUID

import redis.asyncio as redis

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

TTL_SECONDS = 60 * 60


@lru_cache(maxsize=1)
def client() -> redis.Redis:
    return redis.from_url(settings.redis_url, decode_responses=True)


def widget_key(widget_id: UUID, dataset_version: int) -> str:
    return f"widget:{widget_id}:v{dataset_version}"


def widget_invalidation_marker(widget_id: UUID) -> str:
    """A sentinel key bumped on every widget mutation; mirrors dataset.version."""
    return f"widget:{widget_id}:rev"


async def get_widget_data(widget_id: UUID, dataset_version: int) -> dict[str, Any] | None:
    try:
        raw = await client().get(widget_key(widget_id, dataset_version))
    except redis.RedisError as exc:
        logger.warning("redis get failed: %s", exc)
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def set_widget_data(
    widget_id: UUID, dataset_version: int, payload: dict[str, Any]
) -> None:
    try:
        await client().set(
            widget_key(widget_id, dataset_version),
            json.dumps(payload, default=str),
            ex=TTL_SECONDS,
        )
    except redis.RedisError as exc:
        logger.warning("redis set failed: %s", exc)


async def bust_widget(widget_id: UUID) -> None:
    """Invalidate all cached versions for a single widget.

    We don't enumerate keys (potentially expensive); instead we bump a per-widget
    revision sentinel that callers fold into the key when reading. For the simple
    case where the dataset version itself changes, the key already drifts.
    """
    try:
        await client().incr(widget_invalidation_marker(widget_id))
    except redis.RedisError as exc:
        logger.warning("redis incr failed: %s", exc)


async def widget_revision(widget_id: UUID) -> int:
    try:
        raw = await client().get(widget_invalidation_marker(widget_id))
    except redis.RedisError as exc:
        logger.warning("redis get rev failed: %s", exc)
        return 0
    try:
        return int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        return 0


async def bust_dataset(dataset_id: UUID) -> None:
    """Future-proofing hook for Phase 7 (sheet sync). No-op today."""
    logger.debug("dataset bust requested for %s", dataset_id)
