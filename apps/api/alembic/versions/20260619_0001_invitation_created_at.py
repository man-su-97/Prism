"""add missing createdAt column to invitation table

Revision ID: 20260619_0001
Revises: 20260608_0002
Create Date: 2026-06-19 00:00:00.000000

The original better-auth migration (20260512_0001) created the invitation table
without a createdAt column, while Better Auth's kysely adapter expects it on
INSERT. This caused every inviteMember call to fail with:
  column "createdAt" of relation "invitation" does not exist
"""

from alembic import op
import sqlalchemy as sa

revision = "20260619_0001"
down_revision = "20260608_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Fresh installs already have this column (20260512_0001_better_auth.py).
    # Only existing DBs that were deployed before the base migration included it need this.
    op.execute(
        'ALTER TABLE invitation ADD COLUMN IF NOT EXISTS "createdAt"'
        " TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()"
    )


def downgrade() -> None:
    op.drop_column("invitation", "createdAt")
