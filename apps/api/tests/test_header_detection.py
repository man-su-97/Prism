"""Unit tests for header-row detection.

`detect_header_offset` takes the first rows of a file read with header=None
and returns the 0-based index of the real header row (rows above are
preamble to skip). It is deliberately conservative: it returns 0 whenever
there is no confident single header row, so clean files and messy
multi-row-header files alike fall back to current behavior.
"""
from __future__ import annotations

import pathlib

import pandas as pd

from app.services.profile import detect_header_offset

REAL_WORKBOOK = (
    pathlib.Path(__file__).resolve().parent
    / "fixtures"
    / "Ahmedabad Safe City Queries.xlsx"
)


def test_clean_header_on_row_zero_returns_zero():
    raw = pd.DataFrame(
        [
            ["Name", "Age", "City"],
            ["Alice", 30, "NYC"],
            ["Bob", 25, "LA"],
            ["Carol", 41, "SF"],
        ]
    )
    assert detect_header_offset(raw) == 0


def test_title_and_blank_above_header_is_detected():
    raw = pd.DataFrame(
        [
            ["Quarterly Report", None, None],
            [None, None, None],
            ["Name", "Age", "City"],
            ["Alice", 30, "NYC"],
            ["Bob", 25, "LA"],
            ["Carol", 41, "SF"],
        ]
    )
    assert detect_header_offset(raw) == 2


def test_no_confident_header_returns_zero():
    # Rows are sparse relative to data and data carries numbers/dups —
    # the shape of the Ahmedabad sample. No row qualifies.
    raw = pd.DataFrame(
        [
            ["Big Title", None, None, None, None, None],
            ["Group A", None, None, None, "Group B", "Group C"],
            [None, None, None, None, None, None],
            [1, 1, "Pre-Qual", 13, "x", "y"],
            [2, 1, "Capex", 114, "x", "y"],
            [3, 1, "Capex", 117, "x", "y"],
        ]
    )
    assert detect_header_offset(raw) == 0


def test_too_few_rows_returns_zero():
    assert detect_header_offset(pd.DataFrame([["only one row", 1]])) == 0
    assert detect_header_offset(pd.DataFrame()) == 0


def test_first_dense_row_that_is_numeric_is_not_picked():
    # A leading all-numeric row must not be mistaken for a header.
    raw = pd.DataFrame(
        [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
        ]
    )
    assert detect_header_offset(raw) == 0


def test_real_sample_workbook_returns_zero():
    if not REAL_WORKBOOK.exists():
        return  # sample not checked in; skip silently
    raw = pd.read_excel(REAL_WORKBOOK, engine="openpyxl", header=None, nrows=20)
    assert detect_header_offset(raw) == 0
