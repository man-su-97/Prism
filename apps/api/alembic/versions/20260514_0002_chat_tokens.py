"""chat token quota columns on subscriptions

Revision ID: 20260514_0002
Revises: 20260514_0001
Create Date: 2026-05-14 00:02:00.000000

Adds a monthly "chat tokens" entitlement per workspace. Each user chat
message consumes one token; the quota resets on the Stripe billing-cycle
boundary for paid plans and on a 30-day rolling window for Free orgs (who
have no Stripe period). The counter lives on `subscriptions` rather than
in a side table because plan tier and billing period are already there —
keeping reset logic in one place avoids cross-table drift.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260514_0002"
down_revision: Union[str, None] = "20260514_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "subscriptions",
        sa.Column(
            "chat_tokens_used",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "subscriptions",
        sa.Column(
            "chat_tokens_period_end",
            sa.TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )
    # Backfill: paid rows reuse Stripe's period end; Free rows (current_period_end
    # IS NULL) get a 30-day window starting now.
    op.execute(
        "UPDATE subscriptions "
        "SET chat_tokens_period_end = "
        "  COALESCE(current_period_end, NOW() + INTERVAL '30 days')"
    )


def downgrade() -> None:
    op.drop_column("subscriptions", "chat_tokens_period_end")
    op.drop_column("subscriptions", "chat_tokens_used")
