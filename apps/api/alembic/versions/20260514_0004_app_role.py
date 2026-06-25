"""create non-superuser app role so RLS policies actually enforce

Revision ID: 20260514_0004
Revises: 20260514_0003
Create Date: 2026-05-14 00:04:00.000000

The Postgres role `strata` is provisioned by the postgres docker image
from `POSTGRES_USER`, which makes it SUPERUSER + BYPASSRLS. Every
`ENABLE/FORCE ROW LEVEL SECURITY` + `CREATE POLICY` in earlier
migrations has therefore been **dormant** — RLS only fires when the
connecting role is neither SUPERUSER nor BYPASSRLS. The application
always set `app.org_id` correctly via `tenant_session`, so cross-tenant
reads were possible but masked by the application's own filtering — until
the super-admin portal exposed cross-tenant aggregates, which made it
obvious that the policies weren't enforcing anything.

Fix: introduce a second role `strata_app` with login + read/write on
the public schema. Migrations continue to run as `strata` (which owns
the tables and needs CREATE EXTENSION); the FastAPI app, Arq worker,
and Better Auth's pg adapter all connect as `strata_app` from now on.
RLS finally enforces. The {table}_admin_bypass policies added in
20260514_0003 stay relevant — they're the SELECT-only escape hatch for
super-admin queries.

Password is `strata_app` for parity with the existing `strata/strata`
dev defaults. Rotate in prod via:
  ALTER ROLE strata_app WITH PASSWORD '<new>';
and update the matching env vars.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260514_0004"
down_revision: Union[str, None] = "20260514_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CREATE ROLE is idempotent via DO block — re-runs (e.g. local-dev fresh
    # postgres after a manual ALTER ROLE) should not crash.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'strata_app') THEN
                CREATE ROLE strata_app LOGIN PASSWORD 'strata_app'
                    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
            END IF;
        END
        $$;
        """
    )
    # Schema access — the app needs to resolve names; without USAGE on the
    # schema it can't see any tables regardless of table grants.
    op.execute("GRANT USAGE ON SCHEMA public TO strata_app")
    # Read/write on the existing tables. RLS policies still scope visibility
    # — these grants are necessary but not sufficient for cross-tenant access.
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO strata_app"
    )
    op.execute(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO strata_app"
    )
    # Default privileges so future migrations (running as strata, the owner)
    # automatically grant the same privileges on newly created tables /
    # sequences without each migration having to remember to GRANT.
    op.execute(
        """
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO strata_app
        """
    )
    op.execute(
        """
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT USAGE, SELECT ON SEQUENCES TO strata_app
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM strata_app
        """
    )
    op.execute(
        """
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
            REVOKE USAGE, SELECT ON SEQUENCES FROM strata_app
        """
    )
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM strata_app")
    op.execute("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM strata_app")
    op.execute("REVOKE ALL ON SCHEMA public FROM strata_app")
    op.execute("DROP ROLE IF EXISTS strata_app")
