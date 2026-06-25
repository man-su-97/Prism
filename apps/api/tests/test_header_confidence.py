"""Unit tests for the AI-escalation confidence gate.

`header_confidence` scores how header-like a candidate row is (fraction of
cells that are non-null, string, and unique). `should_escalate` is true when
that score is below threshold — the signal to call the AI tier.
"""
from __future__ import annotations

import pandas as pd

from app.services.profile import header_confidence, should_escalate


def test_clean_header_row_is_high_confidence():
    peek = pd.DataFrame(
        [["Name", "Age", "City"], ["Alice", 30, "NYC"], ["Bob", 25, "LA"]]
    )
    assert header_confidence(peek, 0) == 1.0
    assert should_escalate(peek, 0) is False


def test_sparse_title_row_is_low_confidence():
    # Ahmedabad-shaped: row 0 has one filled cell of six.
    peek = pd.DataFrame(
        [
            ["Big Title", None, None, None, None, None],
            ["Group A", None, None, None, "Group B", "Group C"],
            [None, None, None, None, None, None],
            [1, 1, "Pre-Qual", 13, "x", "y"],
        ]
    )
    assert header_confidence(peek, 0) < 0.2
    assert should_escalate(peek, 0) is True


def test_numeric_row_is_low_confidence():
    peek = pd.DataFrame([[1, 2, 3], [4, 5, 6]])
    assert header_confidence(peek, 0) == 0.0
    assert should_escalate(peek, 0) is True


def test_duplicate_labels_lower_confidence():
    peek = pd.DataFrame([["A", "A", "B"], ["1", "2", "3"]])
    # 2 unique strings (A, B) over 3 columns.
    assert abs(header_confidence(peek, 0) - (2 / 3)) < 1e-9
    assert should_escalate(peek, 0) is True  # 0.666 < 0.7


def test_out_of_range_or_too_few_rows():
    assert header_confidence(pd.DataFrame([["A", "B"]]), 0) == 1.0
    assert should_escalate(pd.DataFrame([["A", "B"]]), 0) is False  # <2 rows
    assert header_confidence(pd.DataFrame(), 0) == 0.0
    assert header_confidence(pd.DataFrame([["A"], ["B"]]), 5) == 0.0
