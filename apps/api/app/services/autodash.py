"""Heuristic starter-dashboard generator.

Reads a dataset's profiled columns and produces:
  - 4 KPI cards (row count + 3 numeric KPIs picked by name hints)
  - up to 3 charts (line if datetime, bar if categorical+numeric, pie share-of-total)
  - a placeholder Overview widget (text is filled in by services/overview.py)

Output is a list of widget *specs* — pure data, no DB calls. The caller persists
them to the `widgets` table.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

ColumnKind = Literal["numeric", "datetime", "categorical", "id", "text", "boolean"]

_SUM_HINTS = re.compile(r"(revenue|sales|total|amount|orders|quantity|qty|count)", re.I)
_AVG_HINTS = re.compile(r"(price|rate|score|ratio|percent|pct|avg|average)", re.I)


@dataclass
class WidgetSpec:
    kind: Literal["kpi", "line", "bar", "pie", "table", "overview"]
    title: str
    config: dict[str, Any]
    position: dict[str, int]  # react-grid-layout: {x, y, w, h}


@dataclass
class AutoDashPlan:
    name: str
    widgets: list[WidgetSpec] = field(default_factory=list)
    layout: list[dict[str, Any]] = field(default_factory=list)


def _pick_agg(col_name: str) -> Literal["SUM", "AVG"]:
    if _AVG_HINTS.search(col_name):
        return "AVG"
    if _SUM_HINTS.search(col_name):
        return "SUM"
    return "SUM"


def _numeric_kpi_candidates(columns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        c for c in columns
        if c["kind"] == "numeric" and (c.get("distinct_count") or 0) > 1
    ]


def _datetime_columns(columns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [c for c in columns if c["kind"] == "datetime"]


def _categorical_columns(columns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        (c for c in columns if c["kind"] == "categorical"),
        key=lambda c: c.get("distinct_count") or 0,
    )


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def build_plan(
    dataset_id: uuid.UUID,
    dataset_name: str,
    columns: list[dict[str, Any]],
) -> AutoDashPlan:
    plan = AutoDashPlan(name=f"{dataset_name} dashboard")
    view = "ds_" + str(dataset_id).replace("-", "_")

    # --- KPI row (y=0, four 3-wide cards in a 12-col grid) ---
    plan.widgets.append(
        WidgetSpec(
            kind="kpi",
            title="Total rows",
            config={
                "dataset_id": str(dataset_id),
                "aggregate": "COUNT",
                "column": None,
                "sql": f"SELECT COUNT(*) AS value FROM {view}",
            },
            position={"x": 0, "y": 0, "w": 3, "h": 2},
        )
    )

    numeric = _numeric_kpi_candidates(columns)
    numeric.sort(
        key=lambda c: (
            0 if _SUM_HINTS.search(c["name"]) else (1 if _AVG_HINTS.search(c["name"]) else 2),
            -(c.get("distinct_count") or 0),
        )
    )

    for i, col in enumerate(numeric[:3]):
        agg = _pick_agg(col["name"])
        ident = _quote_ident(col["name"])
        plan.widgets.append(
            WidgetSpec(
                kind="kpi",
                title=f"{agg.title()} of {col['name']}",
                config={
                    "dataset_id": str(dataset_id),
                    "aggregate": agg,
                    "column": col["name"],
                    "sql": f"SELECT {agg}({ident}) AS value FROM {view}",
                },
                position={"x": (i + 1) * 3, "y": 0, "w": 3, "h": 2},
            )
        )

    # --- Charts row (y=2) ---
    dts = _datetime_columns(columns)
    cats = _categorical_columns(columns)
    next_x = 0

    if dts and numeric:
        dt = dts[0]
        n = numeric[0]
        dt_ident = _quote_ident(dt["name"])
        n_ident = _quote_ident(n["name"])
        agg = _pick_agg(n["name"])
        plan.widgets.append(
            WidgetSpec(
                kind="line",
                title=f"{n['name']} over time",
                config={
                    "dataset_id": str(dataset_id),
                    "x": dt["name"],
                    "y": n["name"],
                    "aggregate": agg,
                    "sql": (
                        f"SELECT date_trunc('day', {dt_ident}) AS x, "
                        f"{agg}({n_ident}) AS y "
                        f"FROM {view} WHERE {dt_ident} IS NOT NULL "
                        f"GROUP BY 1 ORDER BY 1"
                    ),
                },
                position={"x": next_x, "y": 2, "w": 6, "h": 4},
            )
        )
        next_x += 6

    if cats and numeric:
        c = cats[0]
        n = numeric[0]
        c_ident = _quote_ident(c["name"])
        n_ident = _quote_ident(n["name"])
        agg = _pick_agg(n["name"])
        plan.widgets.append(
            WidgetSpec(
                kind="bar",
                title=f"{n['name']} by {c['name']}",
                config={
                    "dataset_id": str(dataset_id),
                    "x": c["name"],
                    "y": n["name"],
                    "aggregate": agg,
                    "sql": (
                        f"SELECT {c_ident} AS x, {agg}({n_ident}) AS y "
                        f"FROM {view} WHERE {c_ident} IS NOT NULL "
                        f"GROUP BY 1 ORDER BY 2 DESC LIMIT 25"
                    ),
                },
                position={"x": next_x, "y": 2, "w": 6, "h": 4},
            )
        )
        next_x = (next_x + 6) % 12

    if cats:
        # Use the strongest categorical (smallest distinct count) for the pie.
        c = cats[0]
        c_ident = _quote_ident(c["name"])
        plan.widgets.append(
            WidgetSpec(
                kind="pie",
                title=f"Share by {c['name']}",
                config={
                    "dataset_id": str(dataset_id),
                    "label": c["name"],
                    "sql": (
                        f"SELECT {c_ident} AS label, COUNT(*) AS value "
                        f"FROM {view} WHERE {c_ident} IS NOT NULL "
                        f"GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
                    ),
                },
                position={"x": 0, "y": 6, "w": 4, "h": 4},
            )
        )

    # --- Overview card (filled by Claude separately) ---
    plan.widgets.append(
        WidgetSpec(
            kind="overview",
            title="Dataset overview",
            config={"dataset_id": str(dataset_id)},
            position={"x": 4, "y": 6, "w": 8, "h": 4},
        )
    )

    plan.layout = [
        {"i": str(i), **w.position} for i, w in enumerate(plan.widgets)
    ]
    return plan
