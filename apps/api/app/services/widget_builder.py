"""Build sandboxed widget SQL from a structured config.

Free SQL is *never* accepted from the wizard. The wizard supplies column names
and an aggregation; the server validates the names against `dataset_columns`
for the given dataset and constructs the SQL itself.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Literal

from app.services.duck import view_for_dataset

WidgetKind = Literal["kpi", "line", "bar", "pie", "table"]
Aggregate = Literal["COUNT", "SUM", "AVG", "MIN", "MAX"]

_ALLOWED_AGGREGATES: set[str] = {"COUNT", "SUM", "AVG", "MIN", "MAX"}
_ALLOWED_KINDS: set[str] = {"kpi", "line", "bar", "pie", "table"}
_TIME_BUCKETS: set[str] = {"day", "week", "month", "quarter", "year"}


class BuilderError(ValueError):
    """Raised on invalid widget configuration."""


@dataclass(frozen=True)
class ColumnSpec:
    name: str
    kind: str


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _require_column(name: str, columns: dict[str, ColumnSpec]) -> ColumnSpec:
    spec = columns.get(name)
    if spec is None:
        raise BuilderError(f"unknown column: {name}")
    return spec


def build_widget_config(
    dataset_id: uuid.UUID,
    columns: list[dict[str, Any]],
    *,
    kind: str,
    title: str,
    x: str | None = None,
    y: str | None = None,
    aggregate: str | None = None,
    label: str | None = None,
    value: str | None = None,
    time_bucket: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Return a fully-built widget config dict (incl. generated SQL).

    The caller persists it as `widgets.config_json`.
    """
    if kind not in _ALLOWED_KINDS:
        raise BuilderError(f"unsupported kind: {kind}")
    if not title or not title.strip():
        raise BuilderError("title required")

    col_map = {c["name"]: ColumnSpec(name=c["name"], kind=c["kind"]) for c in columns}
    view = view_for_dataset(dataset_id)

    config: dict[str, Any] = {
        "dataset_id": str(dataset_id),
        "kind": kind,
    }

    if kind == "kpi":
        agg = (aggregate or "COUNT").upper()
        if agg not in _ALLOWED_AGGREGATES:
            raise BuilderError(f"bad aggregate: {agg}")
        if agg == "COUNT" and not y:
            sql = f"SELECT COUNT(*) AS value FROM {view}"
            config.update({"aggregate": "COUNT", "column": None, "sql": sql})
        else:
            if not y:
                raise BuilderError("kpi requires a column")
            col = _require_column(y, col_map)
            if agg != "COUNT" and col.kind not in {"numeric", "id"}:
                raise BuilderError(f"aggregate {agg} requires a numeric column")
            sql = f"SELECT {agg}({_quote_ident(y)}) AS value FROM {view}"
            config.update({"aggregate": agg, "column": y, "sql": sql})
        return config

    if kind == "line":
        if not x or not y:
            raise BuilderError("line chart requires x and y")
        agg = (aggregate or "SUM").upper()
        if agg not in _ALLOWED_AGGREGATES:
            raise BuilderError(f"bad aggregate: {agg}")
        x_col = _require_column(x, col_map)
        y_col = _require_column(y, col_map)
        if x_col.kind != "datetime":
            raise BuilderError("line x must be datetime")
        if y_col.kind not in {"numeric", "id"}:
            raise BuilderError("line y must be numeric")
        bucket = (time_bucket or "day").lower()
        if bucket not in _TIME_BUCKETS:
            raise BuilderError(f"bad time_bucket: {bucket}")
        sql = (
            f"SELECT date_trunc('{bucket}', {_quote_ident(x)}) AS x, "
            f"{agg}({_quote_ident(y)}) AS y "
            f"FROM {view} WHERE {_quote_ident(x)} IS NOT NULL "
            f"GROUP BY 1 ORDER BY 1"
        )
        config.update(
            {"x": x, "y": y, "aggregate": agg, "time_bucket": bucket, "sql": sql}
        )
        return config

    if kind == "bar":
        if not x or not y:
            raise BuilderError("bar chart requires x and y")
        agg = (aggregate or "SUM").upper()
        if agg not in _ALLOWED_AGGREGATES:
            raise BuilderError(f"bad aggregate: {agg}")
        x_col = _require_column(x, col_map)
        y_col = _require_column(y, col_map)
        if x_col.kind not in {"categorical", "text", "id", "boolean"}:
            raise BuilderError("bar x must be categorical")
        if y_col.kind not in {"numeric", "id"}:
            raise BuilderError("bar y must be numeric")
        bar_limit = max(1, min(int(limit or 25), 100))
        sql = (
            f"SELECT {_quote_ident(x)} AS x, {agg}({_quote_ident(y)}) AS y "
            f"FROM {view} WHERE {_quote_ident(x)} IS NOT NULL "
            f"GROUP BY 1 ORDER BY 2 DESC LIMIT {bar_limit}"
        )
        config.update({"x": x, "y": y, "aggregate": agg, "limit": bar_limit, "sql": sql})
        return config

    if kind == "pie":
        if not label:
            raise BuilderError("pie requires a label column")
        lab_col = _require_column(label, col_map)
        if lab_col.kind not in {"categorical", "text", "id", "boolean"}:
            raise BuilderError("pie label must be categorical")
        if value:
            agg = (aggregate or "SUM").upper()
            if agg not in _ALLOWED_AGGREGATES:
                raise BuilderError(f"bad aggregate: {agg}")
            val_col = _require_column(value, col_map)
            if val_col.kind not in {"numeric", "id"}:
                raise BuilderError("pie value must be numeric")
            sql = (
                f"SELECT {_quote_ident(label)} AS label, "
                f"{agg}({_quote_ident(value)}) AS value "
                f"FROM {view} WHERE {_quote_ident(label)} IS NOT NULL "
                f"GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
            )
            config.update(
                {"label": label, "value": value, "aggregate": agg, "sql": sql}
            )
        else:
            sql = (
                f"SELECT {_quote_ident(label)} AS label, COUNT(*) AS value "
                f"FROM {view} WHERE {_quote_ident(label)} IS NOT NULL "
                f"GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
            )
            config.update(
                {"label": label, "value": None, "aggregate": "COUNT", "sql": sql}
            )
        return config

    if kind == "table":
        cols = [c["name"] for c in columns][:10]
        select_list = ", ".join(_quote_ident(c) for c in cols)
        tbl_limit = max(1, min(int(limit or 100), 1000))
        sql = f"SELECT {select_list} FROM {view} LIMIT {tbl_limit}"
        config.update({"columns": cols, "limit": tbl_limit, "sql": sql})
        return config

    raise BuilderError(f"unsupported kind: {kind}")
