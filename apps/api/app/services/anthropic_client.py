"""Singleton Anthropic client + model defaults.

Centralises model selection so Phase 6's tool-use chat agent picks up the same
configuration as Phase 4's overview generator.
"""
from __future__ import annotations

import os
from functools import lru_cache

from anthropic import Anthropic

DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
OVERVIEW_MAX_TOKENS = 600

# Header detection is a cheap structured-extraction task — use a small, fast
# model. Override with ANTHROPIC_HEADER_MODEL.
HEADER_MODEL = os.getenv("ANTHROPIC_HEADER_MODEL", "claude-haiku-4-5-20251001")
HEADER_MAX_TOKENS = 1024


@lru_cache(maxsize=1)
def client() -> Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        # Late failure — overview generation is opt-in. Callers should treat
        # ValueError from this function as "skip the AI step".
        raise ValueError("ANTHROPIC_API_KEY is not set")
    return Anthropic(api_key=api_key)
