"""initial empty baseline

Revision ID: 20260512_0000
Revises:
Create Date: 2026-05-12 00:00:00.000000

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "20260512_0000"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Empty baseline migration. Real tables land in Phase 2 onward."""


def downgrade() -> None:
    """Nothing to undo."""
