"""dashboard_shares: persisted, revocable, optionally email-targeted share links

Revision ID: 20260514_0001
Revises: 20260513_0002
Create Date: 2026-05-14 00:01:00.000000

Phase 9 originally shipped share links as stateless JWTs with no DB record,
which made listing and revocation impossible. Each new link now writes a
row here: the token's `jti` claim points back at the row, so verify() can
check revoked_at without a second round-trip when there's no jti (legacy
tokens minted before this migration still validate).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260514_0001"
down_revision: Union[str, None] = "20260513_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dashboard_shares",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("org_id", sa.Text, nullable=False),
        sa.Column(
            "dashboard_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dashboards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Stored so the modal can re-display the URL after the initial mint.
        # RLS keeps it scoped to the workspace; rotating SHARE_LINK_SECRET
        # still invalidates every row at once.
        sa.Column("token", sa.Text, nullable=False),
        # NULL → public link; set → "private" link emailed to this address.
        sa.Column("recipient_email", sa.Text, nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.Text,
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_dashboard_shares_dashboard",
        "dashboard_shares",
        ["dashboard_id", "created_at"],
    )
    op.create_index("idx_dashboard_shares_org", "dashboard_shares", ["org_id"])

    op.execute("ALTER TABLE dashboard_shares ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE dashboard_shares FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY dashboard_shares_isolation ON dashboard_shares
        USING (org_id = current_setting('app.org_id', true))
        WITH CHECK (org_id = current_setting('app.org_id', true))
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS dashboard_shares_isolation ON dashboard_shares")
    op.drop_index("idx_dashboard_shares_org", table_name="dashboard_shares")
    op.drop_index("idx_dashboard_shares_dashboard", table_name="dashboard_shares")
    op.drop_table("dashboard_shares")
