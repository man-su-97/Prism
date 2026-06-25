"""tenant_probe table + RLS template for org isolation

Revision ID: 20260512_0002
Revises: 20260512_0001
Create Date: 2026-05-12 00:02:00.000000

The tenant_probe table exists ONLY to verify Phase 2's isolation guarantees.
It demonstrates the RLS pattern every future tenant table must follow.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260512_0002"
down_revision: Union[str, None] = "20260512_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "tenant_probe",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("org_id", sa.Text, nullable=False),
        sa.Column("note", sa.Text, nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True),
                  nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_tenant_probe_org", "tenant_probe", ["org_id"])

    # Enable RLS and define the canonical org_id policy.
    op.execute("ALTER TABLE tenant_probe ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_probe FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_probe_isolation ON tenant_probe
        USING (org_id = current_setting('app.org_id', true))
        WITH CHECK (org_id = current_setting('app.org_id', true))
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_probe_isolation ON tenant_probe")
    op.drop_table("tenant_probe")
