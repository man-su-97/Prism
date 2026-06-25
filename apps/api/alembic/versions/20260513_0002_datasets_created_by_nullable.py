"""make datasets.created_by_user_id nullable for GDPR anonymization

Revision ID: 20260513_0002
Revises: 20260513_0001
Create Date: 2026-05-13 00:02:00.000000

When a user deletes their account, datasets they created in workspaces
they merely belong to (not solo-owned) outlive them — the workspace and
its data stay so other members keep access. Erasure under GDPR Art. 17
means we have to scrub the user id from those rows. Allow NULL to make
that a no-history UPDATE.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260513_0002"
down_revision: Union[str, None] = "20260513_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("datasets", "created_by_user_id", nullable=True)


def downgrade() -> None:
    # Backfill anything NULL to a sentinel before re-applying NOT NULL.
    op.execute(
        "UPDATE datasets SET created_by_user_id = 'deleted_user'"
        " WHERE created_by_user_id IS NULL"
    )
    op.alter_column("datasets", "created_by_user_id", nullable=False)
