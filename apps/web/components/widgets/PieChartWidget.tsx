"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart as RcPieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import type { Widget, WidgetDataResponse } from "./types";

const PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];

export function PieChartWidget({
  data,
}: {
  widget: Widget;
  data: WidgetDataResponse;
}) {
  const rows = data.rows.map((r) => ({
    label: String((r as Record<string, unknown>).label ?? ""),
    value: Number((r as Record<string, unknown>).value ?? 0),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RcPieChart>
        <Pie
          data={rows}
          dataKey="value"
          nameKey="label"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="var(--color-background)"
          strokeWidth={3}
          isAnimationActive
          animationDuration={600}
        >
          {rows.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-elevated)",
            fontSize: 12,
            padding: "8px 10px",
            color: "var(--color-popover-foreground)",
          }}
          itemStyle={{ color: "var(--color-popover-foreground)" }}
          labelStyle={{ color: "var(--color-muted-foreground)", fontSize: 11 }}
        />
        <Legend
          wrapperStyle={{
            fontSize: 11,
            color: "var(--color-muted-foreground)",
          }}
          iconType="circle"
          iconSize={8}
        />
      </RcPieChart>
    </ResponsiveContainer>
  );
}
