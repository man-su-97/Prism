"""add datasets.connected_by_user_id for Google Sheet token ownership

Revision ID: 20260515_0001
Revises: 20260514_0004
Create Date: 2026-05-15 00:01:00.000000

`created_by_user_id` records who first added the dataset (audit). For
Sheet-backed datasets we also need to know which user's Google tokens to
use when the worker re-syncs — that user may diverge from the creator
(ownership transfer, disconnect/reconnect, etc.). `connected_by_user_id`
holds that identity. Nullable so non-sheet rows leave it blank and so a
disconnect can NULL it out without violating a constraint.

Backfills existing rows from `created_by_user_id` so the worker can still
sync any sheet dataset created before this migration. Only applies to
`source_kind = 'sheet'` to keep CSV/XLSX rows untouched.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260515_0001"
down_revision: Union[str, None] = "20260514_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("connected_by_user_id", sa.Text, nullable=True))
    op.execute(
        "UPDATE datasets SET connected_by_user_id = created_by_user_id"
        " WHERE source_kind = 'sheet' AND connected_by_user_id IS NULL"
    )


def downgrade() -> None:
    op.drop_column("datasets", "connected_by_user_id")
