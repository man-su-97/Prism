"""better-auth two-factor plugin: user.twoFactorEnabled + twoFactor table

Revision ID: 20260513_0001
Revises: 20260512_0007
Create Date: 2026-05-13 00:01:00.000000

Column names match Better Auth's defaults (camelCase, quoted) so the plugin
runs queries against this schema without column mapping. Not tenant-scoped:
two-factor secrets belong to the user, not a workspace.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260513_0001"
down_revision: Union[str, None] = "20260512_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "twoFactorEnabled",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.create_table(
        "twoFactor",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "userId",
            sa.Text,
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("secret", sa.Text, nullable=False),
        sa.Column("backupCodes", sa.Text, nullable=False),
        sa.Column(
            "verified", sa.Boolean, nullable=False, server_default=sa.true()
        ),
    )
    op.create_index("idx_two_factor_user", "twoFactor", ["userId"])


def downgrade() -> None:
    op.drop_index("idx_two_factor_user", table_name="twoFactor")
    op.drop_table("twoFactor")
    op.drop_column("user", "twoFactorEnabled")
