"""add datasets.header_offset and dashboards.customized

Revision ID: 20260608_0001
Revises: 20260516_0001
Create Date: 2026-06-08 12:00:00.000000

header_offset (nullable int) is the user's manual header-row override for a
dataset: NULL = auto-detect on ingest; N = force header on row N for every
sheet/CSV. customized (bool) marks a dashboard the user has touched (layout
saved or any widget added/edited/removed) so re-ingest only regenerates the
auto starter dashboard when it is still pristine.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260608_0001"
down_revision: Union[str, None] = "20260516_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column("header_offset", sa.Integer(), nullable=True),
    )
    op.add_column(
        "dashboards",
        sa.Column(
            "customized",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Pre-feature dashboards predate the customized flag; mark them all
    # customized so a later re-ingest never auto-deletes a dashboard a user
    # may have already arranged. New auto dashboards start false (pristine)
    # and earn regeneration eligibility.
    op.execute("UPDATE dashboards SET customized = true")


def downgrade() -> None:
    op.drop_column("dashboards", "customized")
    op.drop_column("datasets", "header_offset")
