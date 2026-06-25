"""Unit tests for AI column-name sanitization.

AI-proposed names become SQL identifiers (they land in dataset_columns and the
DuckDB view), so they must be coerced into exactly n_cols safe, unique,
non-empty strings before use.
"""
from __future__ import annotations

from app.services.header_ai import HeaderPlan, sanitize_columns


def test_returns_exactly_n_cols():
    assert len(sanitize_columns(["a", "b"], 4)) == 4
    assert len(sanitize_columns(["a", "b", "c", "d"], 2)) == 2


def test_empty_and_none_become_positional():
    out = sanitize_columns(["", None, "  "], 3)
    assert out == ["column_1", "column_2", "column_3"]


def test_dedupes_case_insensitively():
    out = sanitize_columns(["Name", "name", "NAME"], 3)
    assert out == ["Name", "name 2", "NAME 3"]


def test_collapses_whitespace_and_newlines():
    assert sanitize_columns(["Sr.\n No."], 1) == ["Sr. No."]


def test_caps_length():
    long = "x" * 300
    assert len(sanitize_columns([long], 1)[0]) == 128


def test_headerplan_dataclass():
    p = HeaderPlan(data_start_row=2, columns=["a", "b"])
    assert p.data_start_row == 2 and p.columns == ["a", "b"]
