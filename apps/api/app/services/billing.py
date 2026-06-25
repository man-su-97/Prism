"""Stripe wrapper: customers, checkout, portal, and webhook reconciliation.

We bill per *organization*, not per user. Better Auth owns user-level identity;
this service is the source of truth for `subscriptions(org_id)`.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
import stripe
from sqlalchemy import text

logger = logging.getLogger(__name__)


def _client() -> stripe.StripeClient | None:
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        return None
    return stripe.StripeClient(api_key=key)


@dataclass(frozen=True)
class BillingConfig:
    secret_key: str | None
    webhook_secret: str | None
    success_url: str
    cancel_url: str
    portal_return_url: str


def config() -> BillingConfig:
    base = os.getenv("BETTER_AUTH_URL", "https://app.localhost").rstrip("/")
    return BillingConfig(
        secret_key=os.getenv("STRIPE_SECRET_KEY"),
        webhook_secret=os.getenv("STRIPE_WEBHOOK_SECRET"),
        success_url=os.getenv("STRIPE_SUCCESS_URL", f"{base}/settings/billing?status=success"),
        cancel_url=os.getenv("STRIPE_CANCEL_URL", f"{base}/settings/billing?status=cancelled"),
        portal_return_url=os.getenv("STRIPE_PORTAL_RETURN_URL", f"{base}/settings/billing"),
    )


class BillingError(RuntimeError):
    pass


def _require_client() -> stripe.StripeClient:
    c = _client()
    if c is None:
        raise BillingError("STRIPE_SECRET_KEY not configured")
    return c


def cancel_subscription(engine: sa.Engine, org_id: str) -> None:
    """Immediately cancel an org's active Stripe subscription, if any.

    Safe to call when the org is on Free or has no subscriptions row at all.
    Used by the account-teardown flow before the workspace is deleted —
    once the row's gone we can't recover the Stripe id, so we have to do
    this first.
    """
    with engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
        row = conn.execute(
            text(
                "SELECT stripe_subscription_id FROM subscriptions WHERE org_id = :org"
            ),
            {"org": org_id},
        ).first()
    if row is None or not row.stripe_subscription_id:
        return
    client = _client()
    if client is None:
        # Stripe not configured (dev). The local subscriptions row will be
        # deleted by the caller; nothing remote to clean up.
        return
    try:
        client.subscriptions.cancel(row.stripe_subscription_id)
    except stripe.StripeError as exc:
        # Already-cancelled or unknown subscription ids raise — treat as a
        # warning rather than blocking the user's deletion request.
        logger.warning(
            "stripe cancel for org %s sub %s failed: %s",
            org_id,
            row.stripe_subscription_id,
            exc,
        )


def ensure_subscription_row(engine: sa.Engine, org_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
        conn.execute(
            text(
                """
                INSERT INTO subscriptions (org_id, plan, status)
                VALUES (:org, 'free', 'active')
                ON CONFLICT (org_id) DO NOTHING
                """
            ),
            {"org": org_id},
        )


def get_or_create_customer(
    engine: sa.Engine, org_id: str, org_name: str, user_email: str
) -> str:
    """Return the org's Stripe customer id, creating one if missing."""
    with engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
        row = conn.execute(
            text("SELECT stripe_customer_id FROM subscriptions WHERE org_id = :org"),
            {"org": org_id},
        ).first()
    if row is not None and row.stripe_customer_id:
        return row.stripe_customer_id

    client = _require_client()
    customer = client.customers.create(
        params={
            "name": org_name,
            "email": user_email,
            "metadata": {"org_id": org_id},
        }
    )

    with engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
        conn.execute(
            text(
                """
                INSERT INTO subscriptions (org_id, plan, status, stripe_customer_id)
                VALUES (:org, 'free', 'active', :cid)
                ON CONFLICT (org_id) DO UPDATE
                  SET stripe_customer_id = EXCLUDED.stripe_customer_id,
                      updated_at = NOW()
                """
            ),
            {"org": org_id, "cid": customer.id},
        )
    return customer.id


def create_checkout(
    engine: sa.Engine,
    org_id: str,
    org_name: str,
    user_email: str,
    price_id: str,
) -> str:
    client = _require_client()
    customer_id = get_or_create_customer(engine, org_id, org_name, user_email)
    cfg = config()
    session = client.checkout.sessions.create(
        params={
            "mode": "subscription",
            "customer": customer_id,
            "line_items": [{"price": price_id, "quantity": 1}],
            "allow_promotion_codes": True,
            "success_url": cfg.success_url,
            "cancel_url": cfg.cancel_url,
            "metadata": {"org_id": org_id},
            "subscription_data": {"metadata": {"org_id": org_id}},
        }
    )
    if not session.url:
        raise BillingError("stripe did not return checkout url")
    return session.url


def create_portal_session(
    engine: sa.Engine, org_id: str, org_name: str, user_email: str
) -> str:
    client = _require_client()
    customer_id = get_or_create_customer(engine, org_id, org_name, user_email)
    cfg = config()
    session = client.billing_portal.sessions.create(
        params={"customer": customer_id, "return_url": cfg.portal_return_url}
    )
    if not session.url:
        raise BillingError("stripe did not return portal url")
    return session.url


# --- Webhook reconciliation ---------------------------------------------- #


def _plan_for_price_id(price_id: str | None) -> str:
    if not price_id:
        return "free"
    pro = os.getenv("STRIPE_PRO_PRICE_ID")
    team = os.getenv("STRIPE_TEAM_PRICE_ID")
    if pro and price_id == pro:
        return "pro"
    if team and price_id == team:
        return "team"
    return "free"


def _epoch_to_dt(epoch: int | None) -> datetime | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(int(epoch), tz=UTC)


def construct_event(payload: bytes, signature: str) -> Any:
    cfg = config()
    if not cfg.webhook_secret:
        raise BillingError("STRIPE_WEBHOOK_SECRET not configured")
    return stripe.Webhook.construct_event(payload, signature, cfg.webhook_secret)


def _apply_subscription(
    engine: sa.Engine,
    *,
    org_id: str | None,
    customer_id: str | None,
    subscription_id: str,
    status: str,
    plan: str,
    current_period_end: datetime | None,
    cancel_at_period_end: bool,
) -> None:
    """Idempotent upsert keyed on org_id (preferred) or stripe_customer_id."""
    with engine.begin() as conn:
        if org_id:
            conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": org_id})
            conn.execute(
                text(
                    """
                    INSERT INTO subscriptions (
                      org_id, plan, status, stripe_customer_id,
                      stripe_subscription_id, current_period_end,
                      cancel_at_period_end, updated_at,
                      chat_tokens_used, chat_tokens_period_end
                    ) VALUES (
                      :org, :plan, :status, :cust, :sub, :cpe, :cap, NOW(),
                      0, COALESCE(:cpe, NOW() + INTERVAL '30 days')
                    )
                    ON CONFLICT (org_id) DO UPDATE SET
                      plan = EXCLUDED.plan,
                      status = EXCLUDED.status,
                      stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
                      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                      current_period_end = EXCLUDED.current_period_end,
                      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                      updated_at = NOW(),
                      -- Reset the chat-token counter on plan change or period
                      -- rollover. Re-delivered identical webhooks are a no-op
                      -- because both branches see plan unchanged AND a CPE
                      -- that's not later than the stored one.
                      chat_tokens_used = CASE
                        WHEN subscriptions.plan <> EXCLUDED.plan
                          OR (
                            EXCLUDED.current_period_end IS NOT NULL
                            AND (
                              subscriptions.current_period_end IS NULL
                              OR EXCLUDED.current_period_end > subscriptions.current_period_end
                            )
                          )
                        THEN 0
                        ELSE subscriptions.chat_tokens_used
                      END,
                      chat_tokens_period_end = CASE
                        WHEN subscriptions.plan <> EXCLUDED.plan
                          OR (
                            EXCLUDED.current_period_end IS NOT NULL
                            AND (
                              subscriptions.current_period_end IS NULL
                              OR EXCLUDED.current_period_end > subscriptions.current_period_end
                            )
                          )
                        THEN COALESCE(EXCLUDED.current_period_end, NOW() + INTERVAL '30 days')
                        ELSE subscriptions.chat_tokens_period_end
                      END
                    """
                ),
                {
                    "org": org_id,
                    "plan": plan,
                    "status": status,
                    "cust": customer_id,
                    "sub": subscription_id,
                    "cpe": current_period_end,
                    "cap": cancel_at_period_end,
                },
            )
            return

        if not customer_id:
            logger.warning("subscription event with neither org_id nor customer_id")
            return

        # Webhook arrived without metadata.org_id — fall back to customer lookup
        # WITHOUT the RLS GUC so the row is found regardless of session context.
        # The subscriptions table is FORCE RLS, so we set a permissive context
        # via the customer-id index match.
        row = conn.execute(
            text(
                "SELECT org_id FROM subscriptions WHERE stripe_customer_id = :c"
            ),
            {"c": customer_id},
        ).first()
        if row is None:
            logger.warning("no subscription row for customer %s", customer_id)
            return
        conn.execute(text("SELECT set_config('app.org_id', :org, false)"), {"org": row.org_id})
        conn.execute(
            text(
                """
                UPDATE subscriptions SET
                  plan = :plan, status = :status,
                  stripe_subscription_id = :sub,
                  current_period_end = :cpe,
                  cancel_at_period_end = :cap,
                  updated_at = NOW(),
                  chat_tokens_used = CASE
                    WHEN plan <> :plan
                      OR (
                        :cpe IS NOT NULL
                        AND (
                          current_period_end IS NULL
                          OR :cpe > current_period_end
                        )
                      )
                    THEN 0
                    ELSE chat_tokens_used
                  END,
                  chat_tokens_period_end = CASE
                    WHEN plan <> :plan
                      OR (
                        :cpe IS NOT NULL
                        AND (
                          current_period_end IS NULL
                          OR :cpe > current_period_end
                        )
                      )
                    THEN COALESCE(:cpe, NOW() + INTERVAL '30 days')
                    ELSE chat_tokens_period_end
                  END
                WHERE org_id = :org
                """
            ),
            {
                "org": row.org_id,
                "plan": plan,
                "status": status,
                "sub": subscription_id,
                "cpe": current_period_end,
                "cap": cancel_at_period_end,
            },
        )


def handle_event(engine: sa.Engine, event: Any) -> dict[str, Any]:
    """Apply a Stripe event to our subscriptions table. Returns a summary."""
    etype = event.get("type") if isinstance(event, dict) else event["type"]
    data = event["data"]["object"] if isinstance(event, dict) else event.data.object

    if etype in ("customer.subscription.created", "customer.subscription.updated"):
        sub = data
        sub_id = sub["id"] if isinstance(sub, dict) else sub.id
        status = sub["status"] if isinstance(sub, dict) else sub.status
        customer = sub["customer"] if isinstance(sub, dict) else sub.customer
        metadata = sub.get("metadata") if isinstance(sub, dict) else (sub.metadata or {})
        org_id = metadata.get("org_id") if metadata else None
        items = (sub.get("items") if isinstance(sub, dict) else sub.items) or {}
        item_data = items.get("data") if isinstance(items, dict) else items.data
        first = item_data[0] if item_data else None
        price = (first.get("price") if isinstance(first, dict) else first.price) if first else None
        price_id = (
            (price.get("id") if isinstance(price, dict) else price.id) if price else None
        )
        cpe_field = (
            sub.get("current_period_end") if isinstance(sub, dict) else sub.current_period_end
        )
        cap_field = (
            sub.get("cancel_at_period_end")
            if isinstance(sub, dict)
            else sub.cancel_at_period_end
        )

        _apply_subscription(
            engine,
            org_id=org_id,
            customer_id=customer if isinstance(customer, str) else None,
            subscription_id=sub_id,
            status=status,
            plan=_plan_for_price_id(price_id),
            current_period_end=_epoch_to_dt(cpe_field),
            cancel_at_period_end=bool(cap_field),
        )
        return {"applied": etype, "org_id": org_id, "plan": _plan_for_price_id(price_id)}

    if etype == "customer.subscription.deleted":
        sub = data
        sub_id = sub["id"] if isinstance(sub, dict) else sub.id
        customer = sub["customer"] if isinstance(sub, dict) else sub.customer
        metadata = sub.get("metadata") if isinstance(sub, dict) else (sub.metadata or {})
        org_id = metadata.get("org_id") if metadata else None
        _apply_subscription(
            engine,
            org_id=org_id,
            customer_id=customer if isinstance(customer, str) else None,
            subscription_id=sub_id,
            status="canceled",
            plan="free",
            current_period_end=None,
            cancel_at_period_end=False,
        )
        return {"applied": etype, "org_id": org_id}

    if etype == "checkout.session.completed":
        sess = data
        metadata = sess.get("metadata") if isinstance(sess, dict) else (sess.metadata or {})
        org_id = metadata.get("org_id") if metadata else None
        customer = sess["customer"] if isinstance(sess, dict) else sess.customer
        if org_id and customer:
            with engine.begin() as conn:
                conn.execute(
                    text("SELECT set_config('app.org_id', :org, false)"),
                    {"org": org_id},
                )
                conn.execute(
                    text(
                        """
                        UPDATE subscriptions SET
                          stripe_customer_id = :cust,
                          updated_at = NOW()
                        WHERE org_id = :org
                        """
                    ),
                    {"cust": customer if isinstance(customer, str) else None, "org": org_id},
                )
        return {"applied": etype, "org_id": org_id}

    return {"ignored": etype}
