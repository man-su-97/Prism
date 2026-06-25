"""Plan-limit dependencies for FastAPI routes.

Each enforcer reads the org's current plan, compares against live usage from
Postgres, and raises 402 Payment Required on overflow. Callers that need the
plan itself (e.g. for a plan-aware rate limit) can use `current_plan`.
"""
from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import Principal, principal, tenant_session
from app.services.plans import Plan, get_plan


async def current_plan(
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> Plan:
    row = (
        await session.execute(
            text("SELECT plan, status FROM subscriptions WHERE org_id = :org"),
            {"org": p.org_id},
        )
    ).first()
    if row is None:
        # Lazily create the Free row so all subsequent reads find it.
        await session.execute(
            text(
                "INSERT INTO subscriptions (org_id, plan, status) "
                "VALUES (:org, 'free', 'active') ON CONFLICT (org_id) DO NOTHING"
            ),
            {"org": p.org_id},
        )
        return get_plan("free")
    if row.status in ("canceled", "incomplete_expired", "unpaid"):
        return get_plan("free")
    return get_plan(row.plan)


def _deny(message: str, upgrade_hint: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={"error": "plan_limit", "message": message, "upgrade_hint": upgrade_hint},
    )


async def require_dataset_capacity(
    plan: Plan = Depends(current_plan),
    session: AsyncSession = Depends(tenant_session),
) -> Plan:
    count = (
        await session.execute(
            text(
                "SELECT COUNT(*)::int AS n FROM datasets WHERE status <> 'error'"
            )
        )
    ).one()
    if count.n >= plan.max_datasets:
        raise _deny(
            f"Plan {plan.name} allows up to {plan.max_datasets} datasets.",
            "Upgrade for more dataset capacity.",
        )
    return plan


async def require_widget_capacity_for_dashboard(
    dashboard_id: uuid.UUID,
    plan: Plan = Depends(current_plan),
    session: AsyncSession = Depends(tenant_session),
) -> Plan:
    count = (
        await session.execute(
            text(
                "SELECT COUNT(*)::int AS n FROM widgets WHERE dashboard_id = :id"
            ),
            {"id": dashboard_id},
        )
    ).one()
    if count.n >= plan.max_widgets_per_dashboard:
        raise _deny(
            f"Plan {plan.name} allows up to {plan.max_widgets_per_dashboard} widgets per dashboard.",
            "Upgrade for more widgets per dashboard.",
        )
    return plan
