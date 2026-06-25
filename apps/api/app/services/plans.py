"""Per-plan capacity limits.

Limits land in six places:
- workspace count per user (Better Auth `beforeCreate` hook in apps/web/lib/auth.ts)
- dataset count (POST /api/datasets, POST /api/sheets/connect)
- widgets per dashboard (POST /api/widgets)
- dashboards per dataset (POST /api/dashboards)
- chat messages per hour (POST /api/chat/{dashboard_id}) — feeds rate_limit
- chat tokens per month (POST /api/chat/{dashboard_id}) — feeds chat_tokens

`row_cap` is enforced after ingestion by the worker.

`max_workspaces` is per *user*, evaluated by taking the max across the plans of
the user's existing workspaces (any active paid workspace unlocks the soft cap).
The web layer enforces it; this constant is the source of truth so the UI and
billing page can advertise the same number.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    name: str
    max_workspaces: int
    max_datasets: int
    row_cap: int
    max_widgets_per_dashboard: int
    max_dashboards_per_dataset: int
    chat_per_hour: int
    chat_tokens_per_month: int
    stripe_price_id: str | None
    monthly_price_usd: int


_FREE = Plan(
    name="free",
    max_workspaces=1,
    max_datasets=2,
    row_cap=100_000,
    max_widgets_per_dashboard=10,
    max_dashboards_per_dataset=2,
    chat_per_hour=10,
    chat_tokens_per_month=10,
    stripe_price_id=None,
    monthly_price_usd=0,
)

_PRO = Plan(
    name="pro",
    max_workspaces=100,
    max_datasets=25,
    row_cap=2_000_000,
    max_widgets_per_dashboard=50,
    max_dashboards_per_dataset=10,
    chat_per_hour=100,
    chat_tokens_per_month=200,
    stripe_price_id=os.getenv("STRIPE_PRO_PRICE_ID"),
    monthly_price_usd=29,
)

_TEAM = Plan(
    name="team",
    max_workspaces=100,
    max_datasets=200,
    row_cap=10_000_000,
    max_widgets_per_dashboard=200,
    max_dashboards_per_dataset=50,
    chat_per_hour=500,
    chat_tokens_per_month=1000,
    stripe_price_id=os.getenv("STRIPE_TEAM_PRICE_ID"),
    monthly_price_usd=99,
)


PLANS: dict[str, Plan] = {p.name: p for p in (_FREE, _PRO, _TEAM)}


def get_plan(name: str | None) -> Plan:
    """Return the named plan, falling back to Free for unknown / None."""
    if not name:
        return _FREE
    return PLANS.get(name, _FREE)


def all_plans() -> list[Plan]:
    return [_FREE, _PRO, _TEAM]
