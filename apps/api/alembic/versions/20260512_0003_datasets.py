"""datasets + dataset_columns with RLS

Revision ID: 20260512_0003
Revises: 20260512_0002
Create Date: 2026-05-12 00:03:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260512_0003"
down_revision: Union[str, None] = "20260512_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("org_id", sa.Text, nullable=False),
        sa.Column("created_by_user_id", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("source_kind", sa.Text, nullable=False),
        sa.Column("object_key", sa.Text, nullable=False),
        sa.Column("parquet_path", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'pending'")),
        sa.Column("error", sa.Text),
        sa.Column("row_count", sa.BigInteger),
        sa.Column("size_bytes", sa.BigInteger),
        sa.Column("version", sa.Integer, nullable=False, server_default=sa.text("1")),
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
            "status IN ('pending','uploading','ingesting','ready','error')",
            name="ck_datasets_status",
        ),
        sa.CheckConstraint(
            "source_kind IN ('csv','xlsx','sheet')",
            name="ck_datasets_source_kind",
        ),
    )
    op.create_index("idx_datasets_org", "datasets", ["org_id", "created_at"])

    op.create_table(
        "dataset_columns",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("org_id", sa.Text, nullable=False),
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("dtype", sa.Text, nullable=False),
        sa.Column("nullable", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("null_count", sa.BigInteger, nullable=False, server_default=sa.text("0")),
        sa.Column("distinct_count", sa.BigInteger),
        sa.Column("min_value", sa.Text),
        sa.Column("max_value", sa.Text),
        sa.Column("sample", postgresql.JSONB, server_default=sa.text("'[]'::jsonb")),
        sa.Column("stats", postgresql.JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.CheckConstraint(
            "kind IN ('numeric','datetime','categorical','id','text','boolean')",
            name="ck_dataset_columns_kind",
        ),
    )
    op.create_unique_constraint(
        "uq_dataset_columns_dataset_position",
        "dataset_columns",
        ["dataset_id", "position"],
    )
    op.create_index("idx_dataset_columns_dataset", "dataset_columns", ["dataset_id"])

    # RLS on both tables; SELECT/INSERT/UPDATE/DELETE all key off app.org_id.
    for table in ("datasets", "dataset_columns"):
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
    op.execute("DROP POLICY IF EXISTS dataset_columns_isolation ON dataset_columns")
    op.execute("DROP POLICY IF EXISTS datasets_isolation ON datasets")
    op.drop_table("dataset_columns")
    op.drop_table("datasets")
