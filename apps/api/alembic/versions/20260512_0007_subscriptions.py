"""subscriptions table with RLS

Revision ID: 20260512_0007
Revises: 20260512_0006
Create Date: 2026-05-12 00:07:00.000000

One row per org. Stripe ids are nullable for orgs still on Free.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260512_0007"
down_revision: Union[str, None] = "20260512_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("org_id", sa.Text, primary_key=True),
        sa.Column("plan", sa.Text, nullable=False, server_default=sa.text("'free'")),
        sa.Column(
            "status",
            sa.Text,
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("stripe_customer_id", sa.Text),
        sa.Column("stripe_subscription_id", sa.Text),
        sa.Column("current_period_end", sa.TIMESTAMP(timezone=True)),
        sa.Column(
            "cancel_at_period_end",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "plan IN ('free','pro','team')",
            name="ck_subscriptions_plan",
        ),
        sa.CheckConstraint(
            "status IN ('active','trialing','past_due','canceled','incomplete','incomplete_expired','unpaid')",
            name="ck_subscriptions_status",
        ),
    )
    op.create_index(
        "idx_subscriptions_stripe_customer",
        "subscriptions",
        ["stripe_customer_id"],
        unique=True,
        postgresql_where=sa.text("stripe_customer_id IS NOT NULL"),
    )
    op.create_index(
        "idx_subscriptions_stripe_subscription",
        "subscriptions",
        ["stripe_subscription_id"],
        unique=True,
        postgresql_where=sa.text("stripe_subscription_id IS NOT NULL"),
    )

    op.execute("ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY subscriptions_isolation ON subscriptions
        USING (org_id = current_setting('app.org_id', true))
        WITH CHECK (org_id = current_setting('app.org_id', true))
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS subscriptions_isolation ON subscriptions")
    op.drop_index("idx_subscriptions_stripe_subscription", table_name="subscriptions")
    op.drop_index("idx_subscriptions_stripe_customer", table_name="subscriptions")
    op.drop_table("subscriptions")
