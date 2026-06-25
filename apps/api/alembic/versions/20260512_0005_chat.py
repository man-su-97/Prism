"""chat_sessions + chat_messages with RLS

Revision ID: 20260512_0005
Revises: 20260512_0004
Create Date: 2026-05-12 00:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260512_0005"
down_revision: Union[str, None] = "20260512_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_sessions",
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
        sa.Column("user_id", sa.Text, nullable=False),
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
    )
    op.create_unique_constraint(
        "uq_chat_sessions_dash_user",
        "chat_sessions",
        ["dashboard_id", "user_id"],
    )
    op.create_index("idx_chat_sessions_org", "chat_sessions", ["org_id"])

    op.create_table(
        "chat_messages",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("org_id", sa.Text, nullable=False),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("content", sa.Text, nullable=False, server_default=sa.text("''")),
        sa.Column(
            "tool_calls_json",
            postgresql.JSONB,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "widget_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("widgets.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "role IN ('user','assistant','system','tool')",
            name="ck_chat_messages_role",
        ),
    )
    op.create_index(
        "idx_chat_messages_session", "chat_messages", ["session_id", "created_at"]
    )

    for table in ("chat_sessions", "chat_messages"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_isolation ON {table}
            USING (org_id = current_setting('app.org_id', true))
            WITH CHECK (org_id = current_setting('app.org_id', true))
            """
        )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS chat_messages_isolation ON chat_messages")
    op.execute("DROP POLICY IF EXISTS chat_sessions_isolation ON chat_sessions")
    op.drop_table("chat_messages")
    op.drop_table("chat_sessions")
