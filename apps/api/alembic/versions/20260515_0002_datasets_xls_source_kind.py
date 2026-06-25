"""widen ck_datasets_source_kind to include legacy 'xls'

Revision ID: 20260515_0002
Revises: 20260515_0001
Create Date: 2026-05-15 12:00:00.000000

The dataset uploader now accepts legacy Excel `.xls` files (read via xlrd)
alongside `.xlsx`. The CHECK constraint added in 20260512_0003 only allowed
{'csv','xlsx','sheet'} so a register() with `source_kind='xls'` would 23514
at insert time. This migration drops and recreates the constraint with the
extra value.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260515_0002"
down_revision: Union[str, None] = "20260515_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_datasets_source_kind", "datasets", type_="check")
    op.create_check_constraint(
        "ck_datasets_source_kind",
        "datasets",
        "source_kind IN ('csv','xlsx','xls','sheet')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_datasets_source_kind", "datasets", type_="check")
    op.create_check_constraint(
        "ck_datasets_source_kind",
        "datasets",
        "source_kind IN ('csv','xlsx','sheet')",
    )
