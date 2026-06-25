"""admin RLS bypass policies for the super-admin read-only portal

Revision ID: 20260514_0003
Revises: 20260514_0002
Create Date: 2026-05-14 00:03:00.000000

Every tenant table has ENABLE + FORCE ROW LEVEL SECURITY keyed on
`current_setting('app.org_id', true)`. FORCE means even superuser obeys
policy, so the super-admin portal — which spans all tenants — needs a
SQL-level escape hatch. We add one PERMISSIVE FOR SELECT policy per
tenant table, gated on a new GUC `app.is_admin = 'true'`. Postgres OR's
permissive policies attached to the same table, so the existing
`{table}_isolation` policy continues to scope normal `tenant_session`
requests (which never set `app.is_admin`).

FOR SELECT only — v1 of the portal is strictly read-only. If a future
phase introduces admin mutations, that phase must (a) widen this
policy or add an admin INSERT/UPDATE/DELETE sibling, and (b) lift the
read-only invariant in CLAUDE.md.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260514_0003"
down_revision: Union[str, None] = "20260514_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES: tuple[str, ...] = (
    "tenant_probe",
    "datasets",
    "dataset_columns",
    "dashboards",
    "widgets",
    "chat_sessions",
    "chat_messages",
    "subscriptions",
    "dashboard_shares",
)


def upgrade() -> None:
    for table in TENANT_TABLES:
        op.execute(
            f"""
            CREATE POLICY {table}_admin_bypass ON {table}
            AS PERMISSIVE FOR SELECT
            USING (current_setting('app.is_admin', true) = 'true')
            """
        )


def downgrade() -> None:
    for table in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_admin_bypass ON {table}")
