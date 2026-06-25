"""add worksheet_names jsonb column to datasets

Revision ID: 20260516_0001
Revises: 20260515_0002
Create Date: 2026-05-16 12:00:00.000000

The upload pipeline now lets users pick one or more sheets from an xlsx/xls
workbook; selected sheets are stacked into a single dataset's parquet with
an outer-union by column name and a `_sheet` text column carrying the source
sheet name. The chosen sheet titles are persisted so the worker knows which
to read and so re-ingestion is deterministic.

NULL = legacy behaviour (read the first sheet); preserved for csv/sheet rows
and any pre-feature xlsx rows.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260516_0001"
down_revision: Union[str, None] = "20260515_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column(
            "worksheet_names",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("datasets", "worksheet_names")
