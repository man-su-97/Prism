"""Regression tests for Parquet-safe column normalization.

A real upload (`test/Ahmedabad Safe City Queries.xlsx`, a formatted report
rather than a clean table) crashed ingestion with
`ArrowTypeError: Expected bytes, got a 'int' object` because an object-dtype
column held a mix of Python str / int / float-NaN. pyarrow infers a column's
Arrow type from its leading values and then fails on the first value that
doesn't fit. `normalize_for_parquet` makes each object column homogeneous
before the write.
"""
from __future__ import annotations

import pathlib

import numpy as np
import pandas as pd
import pyarrow as pa
import pytest

from app.services.profile import normalize_for_parquet

REAL_WORKBOOK = (
    pathlib.Path(__file__).resolve().parent
    / "fixtures"
    / "Ahmedabad Safe City Queries.xlsx"
)


def _write_parquet(df: pd.DataFrame, tmp_path: pathlib.Path) -> pd.DataFrame:
    target = tmp_path / "out.parquet"
    df.to_parquet(target, index=False, engine="pyarrow", compression="snappy")
    return pd.read_parquet(target)


def test_mixed_str_int_column_is_unwritable_then_normalized(tmp_path):
    df = pd.DataFrame({"col": ["header", np.nan, "Sr. No.", 1, 2, 3]})

    # Sanity: the raw mixed-type frame is what blows up in ingestion today.
    with pytest.raises(pa.ArrowTypeError):
        df.copy().to_parquet(tmp_path / "raw.parquet", engine="pyarrow")

    out = normalize_for_parquet(df.copy())
    roundtrip = _write_parquet(out, tmp_path)
    values = roundtrip["col"].dropna().tolist()
    assert values == ["header", "Sr. No.", "1", "2", "3"]


def test_all_numeric_object_column_is_coerced_to_number(tmp_path):
    df = pd.DataFrame({"n": ["1", 2, "3", np.nan]})

    out = normalize_for_parquet(df.copy())
    assert pd.api.types.is_numeric_dtype(out["n"])
    roundtrip = _write_parquet(out, tmp_path)
    assert roundtrip["n"].dropna().tolist() == [1.0, 2.0, 3.0]


def test_clean_columns_are_left_untouched():
    df = pd.DataFrame(
        {
            "s": ["a", "b", None],
            "i": [1, 2, 3],
            "f": [1.5, 2.5, np.nan],
        }
    )
    out = normalize_for_parquet(df.copy())
    pd.testing.assert_frame_equal(out, df)


@pytest.mark.skipif(
    not REAL_WORKBOOK.exists(), reason="sample workbook not checked in"
)
def test_real_messy_workbook_becomes_parquet_safe(tmp_path):
    df = pd.read_excel(REAL_WORKBOOK, engine="openpyxl")

    with pytest.raises(pa.ArrowTypeError):
        df.copy().to_parquet(tmp_path / "raw.parquet", engine="pyarrow")

    out = normalize_for_parquet(df.copy())
    _write_parquet(out, tmp_path)
