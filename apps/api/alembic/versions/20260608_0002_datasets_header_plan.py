"""add datasets.header_plan jsonb

Revision ID: 20260608_0002
Revises: 20260608_0001
Create Date: 2026-06-08 13:30:00.000000

header_plan persists the AI-assisted header decision per worksheet so re-ingest
is deterministic and the API is paid once. Shape:
  { "<sheet_key>": {"data_start_row": int, "columns": [str, ...]}, ... }
where sheet_key is the worksheet title (multi-sheet) or "__file__" (csv /
first-sheet). NULL = no AI plan (heuristic or manual override).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260608_0002"
down_revision: Union[str, None] = "20260608_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "datasets",
        sa.Column(
            "header_plan",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("datasets", "header_plan")
