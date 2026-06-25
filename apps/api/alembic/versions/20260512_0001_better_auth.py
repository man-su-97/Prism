"""better-auth schema: user, account, session, verification, organization, member, invitation

Revision ID: 20260512_0001
Revises: 20260512_0000
Create Date: 2026-05-12 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260512_0001"
down_revision: Union[str, None] = "20260512_0000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Better Auth core tables — column names match the library's defaults.
    op.create_table(
        "user",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("email", sa.Text, nullable=False, unique=True),
        sa.Column("name", sa.Text),
        sa.Column("emailVerified", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("image", sa.Text),
        sa.Column("createdAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updatedAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "account",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("userId", sa.Text, sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("accountId", sa.Text, nullable=False),
        sa.Column("providerId", sa.Text, nullable=False),
        sa.Column("accessToken", sa.Text),
        sa.Column("refreshToken", sa.Text),
        sa.Column("idToken", sa.Text),
        sa.Column("accessTokenExpiresAt", sa.TIMESTAMP(timezone=True)),
        sa.Column("refreshTokenExpiresAt", sa.TIMESTAMP(timezone=True)),
        sa.Column("scope", sa.Text),
        sa.Column("password", sa.Text),
        sa.Column("createdAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updatedAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_account_user", "account", ["userId"])
    op.create_unique_constraint("uq_account_provider", "account", ["providerId", "accountId"])

    op.create_table(
        "session",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("userId", sa.Text, sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.Text, nullable=False, unique=True),
        sa.Column("expiresAt", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("ipAddress", sa.Text),
        sa.Column("userAgent", sa.Text),
        sa.Column("activeOrganizationId", sa.Text),
        sa.Column("createdAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updatedAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_session_user", "session", ["userId"])

    op.create_table(
        "verification",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("identifier", sa.Text, nullable=False),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("expiresAt", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("createdAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updatedAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_verification_identifier", "verification", ["identifier"])

    # Organization plugin tables.
    op.create_table(
        "organization",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("slug", sa.Text, nullable=False, unique=True),
        sa.Column("logo", sa.Text),
        sa.Column("createdAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("metadata", postgresql.JSONB, server_default=sa.text("'{}'::jsonb")),
    )

    op.create_table(
        "member",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organizationId", sa.Text, sa.ForeignKey("organization.id", ondelete="CASCADE"), nullable=False),
        sa.Column("userId", sa.Text, sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.Text, nullable=False, server_default=sa.text("'member'")),
        sa.Column("createdAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_unique_constraint("uq_member_org_user", "member", ["organizationId", "userId"])
    op.create_index("idx_member_user", "member", ["userId"])

    op.create_table(
        "invitation",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("organizationId", sa.Text, sa.ForeignKey("organization.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.Text, nullable=False),
        sa.Column("role", sa.Text, nullable=False, server_default=sa.text("'member'")),
        sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'pending'")),
        sa.Column("inviterId", sa.Text, sa.ForeignKey("user.id", ondelete="SET NULL")),
        sa.Column("expiresAt", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("createdAt", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_invitation_org", "invitation", ["organizationId"])
    op.create_index("idx_invitation_email", "invitation", ["email"])


def downgrade() -> None:
    op.drop_table("invitation")
    op.drop_table("member")
    op.drop_table("organization")
    op.drop_table("verification")
    op.drop_table("session")
    op.drop_table("account")
    op.drop_table("user")
