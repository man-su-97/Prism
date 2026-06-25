"use client";

import { useId } from "react";
import {
  Bar,
  BarChart as RcBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Widget, WidgetDataResponse } from "./types";

export function BarChartWidget({
  data,
}: {
  widget: Widget;
  data: WidgetDataResponse;
}) {
  const rows = data.rows.map((r) => ({
    x: String((r as Record<string, unknown>).x ?? ""),
    y: Number((r as Record<string, unknown>).y ?? 0),
  }));

  const gradientId = useId();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RcBarChart data={rows} margin={{ top: 8, right: 12, bottom: 24, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-chart-grid)"
          opacity={1}
          vertical={false}
        />
        <XAxis
          dataKey="x"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          tickMargin={8}
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <YAxis
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          cursor={{ fill: "var(--color-muted)", opacity: 0.6 }}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-elevated)",
            fontSize: 12,
            padding: "8px 10px",
            color: "var(--color-popover-foreground)",
          }}
          labelStyle={{
            color: "var(--color-muted-foreground)",
            marginBottom: 4,
            fontSize: 11,
          }}
          itemStyle={{ color: "var(--color-popover-foreground)" }}
        />
        <Bar
          dataKey="y"
          fill={`url(#${gradientId})`}
          radius={[6, 6, 0, 0]}
          isAnimationActive
          animationDuration={600}
        />
      </RcBarChart>
    </ResponsiveContainer>
  );
}
