"""add sheet sync columns to datasets

Revision ID: 20260512_0006
Revises: 20260512_0005
Create Date: 2026-05-12 00:06:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260512_0006"
down_revision: Union[str, None] = "20260512_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("sheet_spreadsheet_id", sa.Text))
    op.add_column("datasets", sa.Column("sheet_worksheet_title", sa.Text))
    op.add_column(
        "datasets",
        sa.Column("sheet_last_sync_at", sa.TIMESTAMP(timezone=True)),
    )
    op.add_column(
        "datasets",
        sa.Column(
            "refresh_interval_minutes",
            sa.Integer,
            nullable=False,
            server_default=sa.text("60"),
        ),
    )
    op.create_index(
        "idx_datasets_sheet_due",
        "datasets",
        ["source_kind", "sheet_last_sync_at"],
        postgresql_where=sa.text("source_kind = 'sheet'"),
    )


def downgrade() -> None:
    op.drop_index("idx_datasets_sheet_due", table_name="datasets")
    op.drop_column("datasets", "refresh_interval_minutes")
    op.drop_column("datasets", "sheet_last_sync_at")
    op.drop_column("datasets", "sheet_worksheet_title")
    op.drop_column("datasets", "sheet_spreadsheet_id")
