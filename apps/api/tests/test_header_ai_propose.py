"""Unit tests for AI tool-output parsing/validation (no network).

The risky logic is turning a Claude tool_use block into a validated HeaderPlan.
We feed fake blocks; the live API call in `propose_header` is covered by manual
smoke, not here.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.services.header_ai import (
    HeaderPlan,
    _extract_tool_input,
    _plan_from_tool_input,
    _render_grid,
)


def _resp(blocks):
    return SimpleNamespace(content=blocks)


def test_extract_tool_input_finds_matching_block():
    block = SimpleNamespace(
        type="tool_use", name="report_header", input={"data_start_row": 1, "columns": ["a"]}
    )
    assert _extract_tool_input(_resp([block]), "report_header") == {
        "data_start_row": 1,
        "columns": ["a"],
    }


def test_extract_tool_input_returns_none_when_absent():
    text_block = SimpleNamespace(type="text", text="hi")
    assert _extract_tool_input(_resp([text_block]), "report_header") is None


def test_valid_plan_is_sanitized():
    plan = _plan_from_tool_input(
        {"data_start_row": 2, "columns": ["Name", "name"]}, n_cols=2, n_peek_rows=5
    )
    assert isinstance(plan, HeaderPlan)
    assert plan.data_start_row == 2
    assert plan.columns == ["Name", "name 2"]


def test_rejects_column_count_mismatch():
    assert _plan_from_tool_input(
        {"data_start_row": 1, "columns": ["a", "b"]}, n_cols=3, n_peek_rows=5
    ) is None


def test_rejects_out_of_range_row():
    assert _plan_from_tool_input(
        {"data_start_row": 9, "columns": ["a"]}, n_cols=1, n_peek_rows=5
    ) is None
    assert _plan_from_tool_input(
        {"data_start_row": -1, "columns": ["a"]}, n_cols=1, n_peek_rows=5
    ) is None


def test_rejects_malformed_input():
    assert _plan_from_tool_input({}, n_cols=1, n_peek_rows=5) is None
    assert _plan_from_tool_input(
        {"data_start_row": "x", "columns": ["a"]}, n_cols=1, n_peek_rows=5
    ) is None
    assert _plan_from_tool_input(
        {"data_start_row": 1, "columns": "nope"}, n_cols=1, n_peek_rows=5
    ) is None


def test_render_grid_includes_row_indices_and_handles_nan():
    grid = _render_grid([["A", None], ["x", 1]])
    assert "row 0" in grid and "row 1" in grid
    assert "A" in grid and "x" in grid
