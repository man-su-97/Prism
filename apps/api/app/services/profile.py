"""Column type inference and lightweight statistics.

Output is intentionally JSON-friendly so it can land directly in
`dataset_columns.stats` / `dataset_columns.sample`.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import pandas as pd
from pandas.api.types import (
    is_bool_dtype,
    is_datetime64_any_dtype,
    is_numeric_dtype,
    is_object_dtype,
    is_string_dtype,
)

ColumnKind = str  # 'numeric' | 'datetime' | 'categorical' | 'id' | 'text' | 'boolean'

_SAMPLE_SIZE = 5
_CATEGORICAL_MAX_DISTINCT = 30
_ID_NAME_HINTS = ("id", "uuid", "guid")


@dataclass
class ColumnProfile:
    name: str
    position: int
    kind: ColumnKind
    dtype: str
    nullable: bool
    null_count: int
    distinct_count: int | None
    min_value: str | None
    max_value: str | None
    sample: list[Any]
    stats: dict[str, Any]

    def to_record(self) -> dict[str, Any]:
        return asdict(self)


def normalize_for_parquet(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce mixed-type object columns into a Parquet-safe uniform type.

    Spreadsheets routinely yield object-dtype columns holding a mix of Python
    str / int / float in the same column (title rows, merged cells, a stray
    label inside an otherwise numeric column). pyarrow infers a column's Arrow
    type from its leading values and then raises ArrowTypeError on the first
    value that doesn't fit ("Expected bytes, got a 'int' object"), which dies
    in `ingest._write_parquet`. Make each object column homogeneous in place:
    keep it numeric when every non-null value parses as a number, otherwise
    stringify (NaN/None stay null so they remain SQL NULL in DuckDB, not the
    literal "nan"). Mutates and returns the same frame. Clean columns —
    already a single Python type, or a real numeric/datetime dtype — are left
    untouched.
    """
    for col in df.columns:
        series = df[col]
        if series.dtype != object:
            continue
        non_null = series.dropna()
        if non_null.empty:
            continue
        # Homogeneous Python type already → pyarrow can infer it cleanly.
        if non_null.map(type).nunique() == 1:
            continue
        numeric = pd.to_numeric(non_null, errors="coerce")
        if bool(numeric.notna().all()):
            df[col] = pd.to_numeric(series, errors="coerce")
        else:
            df[col] = series.map(lambda v: None if pd.isna(v) else str(v))
    return df


def detect_header_offset(raw_df: pd.DataFrame, max_scan: int = 20) -> int:
    """Find the header row in a frame read with header=None.

    Returns the 0-based index of the first row that confidently looks like a
    header (a text-label row, about as populated as the data beneath it),
    with all rows above treated as preamble/title to skip. Returns 0 when no
    row qualifies — the safe default that keeps clean files and messy
    multi-row-header files (which no single-row heuristic handles) on current
    behavior. Conservative on purpose: a wrong guess is worse than none.
    """
    n_rows = len(raw_df)
    if n_rows < 2:
        return 0
    n_cols = raw_df.shape[1]
    if n_cols == 0:
        return 0

    scan = min(max_scan, n_rows)

    def fill_ratio(idx: int) -> float:
        row = raw_df.iloc[idx]
        return float(row.notna().sum()) / n_cols

    for r in range(scan):
        if r >= n_rows - 1:  # need at least one data row below
            break
        row = raw_df.iloc[r]
        non_null = row.dropna()
        n_non_null = len(non_null)
        if n_non_null == 0:
            continue

        fill = n_non_null / n_cols
        string_ratio = sum(isinstance(v, str) for v in non_null) / n_non_null
        unique_ratio = non_null.astype(str).nunique() / n_non_null

        below = [fill_ratio(j) for j in range(r + 1, min(r + 6, n_rows))]
        below_fill = float(pd.Series(below).median()) if below else 0.0

        qualifies = (
            fill >= 0.5
            and string_ratio >= 0.8
            and unique_ratio >= 0.9
            and below_fill >= 0.5
            and fill >= 0.9 * below_fill
        )
        if qualifies:
            return r

    return 0


def header_confidence(peek: pd.DataFrame, offset: int) -> float:
    """How header-like is row `offset`: the fraction of columns whose cell at
    that row is a non-null, unique string. 1.0 = every column has a distinct
    text label (a clean header); low = sparse/numeric/duplicated (needs help).
    Returns 0.0 when the row is out of range or the frame has no columns.
    """
    n_rows = len(peek)
    n_cols = peek.shape[1] if n_rows else 0
    if n_cols == 0 or offset < 0 or offset >= n_rows:
        return 0.0
    row = peek.iloc[offset]
    strings = {v for v in row.dropna() if isinstance(v, str)}
    return len(strings) / n_cols


def should_escalate(
    peek: pd.DataFrame, offset: int, threshold: float = 0.7
) -> bool:
    """True when the chosen header row is not confidently a header — the
    signal to escalate to the AI tier. Needs >=2 rows (a header + data)."""
    if len(peek) < 2:
        return False
    return header_confidence(peek, offset) < threshold


def _to_scalar(v: Any) -> Any:
    if pd.isna(v):
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "item"):
        try:
            return v.item()
        except (ValueError, TypeError):
            return str(v)
    return v


def _sample_values(series: pd.Series) -> list[Any]:
    head = series.dropna().head(_SAMPLE_SIZE).tolist()
    return [_to_scalar(v) for v in head]


def _looks_like_id(name: str, distinct_count: int, total: int) -> bool:
    lname = name.lower()
    if any(lname == h or lname.endswith(f"_{h}") for h in _ID_NAME_HINTS):
        return True
    if total > 0 and distinct_count == total:
        return True
    return False


def _classify(name: str, series: pd.Series) -> ColumnKind:
    if is_bool_dtype(series):
        return "boolean"
    if is_datetime64_any_dtype(series):
        return "datetime"

    non_null = series.dropna()
    total = len(non_null)
    distinct = non_null.nunique()

    if is_numeric_dtype(series):
        if _looks_like_id(name, distinct, len(series)):
            return "id"
        return "numeric"

    if is_string_dtype(series) or is_object_dtype(series):
        # Try parsing as datetime first.
        parsed = pd.to_datetime(non_null.head(1000), errors="coerce", utc=False)
        if parsed.notna().sum() >= max(1, int(0.9 * min(1000, total))) and total > 0:
            return "datetime"

        if _looks_like_id(name, distinct, len(series)):
            return "id"

        if 0 < distinct <= _CATEGORICAL_MAX_DISTINCT:
            return "categorical"

        return "text"

    return "text"


def _numeric_stats(series: pd.Series) -> dict[str, Any]:
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty:
        return {}
    return {
        "min": _to_scalar(s.min()),
        "max": _to_scalar(s.max()),
        "mean": float(s.mean()),
        "median": float(s.median()),
        "std": float(s.std(ddof=0)) if len(s) > 1 else 0.0,
    }


def _datetime_stats(series: pd.Series) -> dict[str, Any]:
    s = pd.to_datetime(series, errors="coerce", utc=False).dropna()
    if s.empty:
        return {}
    return {
        "min": _to_scalar(s.min()),
        "max": _to_scalar(s.max()),
    }


def _categorical_stats(series: pd.Series) -> dict[str, Any]:
    counts = series.dropna().value_counts().head(_CATEGORICAL_MAX_DISTINCT)
    return {
        "top": [{"value": _to_scalar(v), "count": int(c)} for v, c in counts.items()],
    }


def profile_dataframe(df: pd.DataFrame) -> list[ColumnProfile]:
    """Return per-column profiles for a DataFrame."""
    profiles: list[ColumnProfile] = []
    total_rows = len(df)
    for position, col in enumerate(df.columns):
        series = df[col]
        kind = _classify(str(col), series)
        non_null = series.dropna()
        distinct = int(non_null.nunique()) if total_rows else 0
        null_count = int(series.isna().sum())

        stats: dict[str, Any] = {}
        if kind == "numeric":
            stats = _numeric_stats(series)
        elif kind == "datetime":
            stats = _datetime_stats(series)
        elif kind == "categorical":
            stats = _categorical_stats(series)

        min_v = stats.get("min")
        max_v = stats.get("max")

        profiles.append(
            ColumnProfile(
                name=str(col),
                position=position,
                kind=kind,
                dtype=str(series.dtype),
                nullable=null_count > 0,
                null_count=null_count,
                distinct_count=distinct,
                min_value=str(min_v) if min_v is not None else None,
                max_value=str(max_v) if max_v is not None else None,
                sample=_sample_values(series),
                stats=stats,
            )
        )
    return profiles
