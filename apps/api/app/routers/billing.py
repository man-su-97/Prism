from __future__ import annotations

import logging
from typing import Any

import sqlalchemy as sa
import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.deps.auth import Principal, principal, tenant_session
from app.services import billing, chat_tokens
from app.services.plans import Plan, all_plans, get_plan

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])
settings = get_settings()


def _sync_engine() -> sa.Engine:
    sync_url = settings.database_url.replace("+asyncpg", "+psycopg")
    return sa.create_engine(sync_url, pool_pre_ping=True, future=True)


class PlanLimits(BaseModel):
    name: str
    max_workspaces: int
    max_datasets: int
    row_cap: int
    max_widgets_per_dashboard: int
    max_dashboards_per_dataset: int
    chat_per_hour: int
    chat_tokens_per_month: int
    monthly_price_usd: int
    stripe_price_id: str | None


class PlanUsage(BaseModel):
    datasets: int
    chat_tokens_used: int
    chat_tokens_remaining: int
    chat_tokens_period_end: str | None


class PlanResponse(BaseModel):
    plan: PlanLimits
    usage: PlanUsage
    status: str
    cancel_at_period_end: bool
    current_period_end: str | None
    available_plans: list[PlanLimits]


def _plan_limits(plan: Plan) -> PlanLimits:
    return PlanLimits(
        name=plan.name,
        max_workspaces=plan.max_workspaces,
        max_datasets=plan.max_datasets,
        row_cap=plan.row_cap,
        max_widgets_per_dashboard=plan.max_widgets_per_dashboard,
        max_dashboards_per_dataset=plan.max_dashboards_per_dataset,
        chat_per_hour=plan.chat_per_hour,
        chat_tokens_per_month=plan.chat_tokens_per_month,
        monthly_price_usd=plan.monthly_price_usd,
        stripe_price_id=plan.stripe_price_id,
    )


@router.get("/plan", response_model=PlanResponse)
async def get_billing_plan(
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> PlanResponse:
    sub_row = (
        await session.execute(
            text(
                "SELECT plan, status, current_period_end, cancel_at_period_end "
                "FROM subscriptions WHERE org_id = :org"
            ),
            {"org": p.org_id},
        )
    ).first()

    if sub_row is None:
        # Lazily create a Free row so first GET doesn't 404.
        await session.execute(
            text(
                "INSERT INTO subscriptions (org_id, plan, status) "
                "VALUES (:org, 'free', 'active') "
                "ON CONFLICT (org_id) DO NOTHING"
            ),
            {"org": p.org_id},
        )
        plan = get_plan("free")
        plan_status = "active"
        cancel_at = False
        cpe = None
    else:
        plan = get_plan(sub_row.plan)
        plan_status = sub_row.status
        cancel_at = bool(sub_row.cancel_at_period_end)
        cpe = sub_row.current_period_end.isoformat() if sub_row.current_period_end else None

    count_row = (
        await session.execute(
            text(
                "SELECT COUNT(*)::int AS n FROM datasets WHERE status <> 'error'"
            )
        )
    ).one()
    tokens = await chat_tokens.get_status(session, p.org_id, plan)
    usage = PlanUsage(
        datasets=count_row.n,
        chat_tokens_used=tokens.used,
        chat_tokens_remaining=tokens.remaining,
        chat_tokens_period_end=tokens.period_end.isoformat() if tokens.period_end else None,
    )

    return PlanResponse(
        plan=_plan_limits(plan),
        usage=usage,
        status=plan_status,
        cancel_at_period_end=cancel_at,
        current_period_end=cpe,
        available_plans=[_plan_limits(pp) for pp in all_plans()],
    )


class CheckoutBody(BaseModel):
    plan: str


class CheckoutResponse(BaseModel):
    url: str


async def _org_meta(session: AsyncSession, org_id: str, user_id: str) -> tuple[str, str]:
    org = (
        await session.execute(
            text("SELECT name FROM organization WHERE id = :id"),
            {"id": org_id},
        )
    ).first()
    user = (
        await session.execute(
            text('SELECT email FROM "user" WHERE id = :id'),
            {"id": user_id},
        )
    ).first()
    return (
        org.name if org else org_id,
        user.email if user else "billing@example.com",
    )


@router.post("/checkout", response_model=CheckoutResponse)
async def start_checkout(
    body: CheckoutBody,
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> CheckoutResponse:
    target = get_plan(body.plan)
    if target.name == "free" or not target.stripe_price_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "plan_not_purchasable")

    org_name, user_email = await _org_meta(session, p.org_id, p.user_id)
    await session.commit()  # ensure subscriptions row creation in the same txn is durable

    engine = _sync_engine()
    try:
        url = billing.create_checkout(
            engine, p.org_id, org_name, user_email, target.stripe_price_id
        )
    except billing.BillingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return CheckoutResponse(url=url)


@router.post("/portal", response_model=CheckoutResponse)
async def open_portal(
    p: Principal = Depends(principal),
    session: AsyncSession = Depends(tenant_session),
) -> CheckoutResponse:
    org_name, user_email = await _org_meta(session, p.org_id, p.user_id)
    await session.commit()

    engine = _sync_engine()
    try:
        url = billing.create_portal_session(engine, p.org_id, org_name, user_email)
    except billing.BillingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return CheckoutResponse(url=url)


@router.post("/webhook", include_in_schema=False)
async def webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="stripe-signature"),
) -> dict[str, Any]:
    payload = await request.body()
    if not stripe_signature:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing_signature")
    try:
        event = billing.construct_event(payload, stripe_signature)
    except billing.BillingError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc)) from exc
    except (stripe.error.SignatureVerificationError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid_signature") from exc

    engine = _sync_engine()
    try:
        result = billing.handle_event(engine, event)
    except Exception:
        logger.exception("webhook handler crashed")
        # Surface 200 so Stripe doesn't retry indefinitely on a permanent bug.
        return {"applied": False, "error": "handler_exception"}
    return {"applied": True, **result}
