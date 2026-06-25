"use client";

import { useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Widget, WidgetDataResponse } from "./types";

function toLabel(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.length > 16 ? v.slice(0, 16) : v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function LineChartWidget({
  data,
}: {
  widget: Widget;
  data: WidgetDataResponse;
}) {
  const rows = data.rows.map((r) => ({
    x: toLabel((r as Record<string, unknown>).x),
    y: Number((r as Record<string, unknown>).y ?? 0),
  }));

  const gradientId = useId();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
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
          cursor={{
            stroke: "var(--color-chart-1)",
            strokeDasharray: "3 3",
            strokeWidth: 1,
          }}
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
        <Area
          type="monotone"
          dataKey="y"
          stroke="none"
          fill={`url(#${gradientId})`}
          isAnimationActive
          animationDuration={600}
        />
        <Line
          type="monotone"
          dataKey="y"
          stroke="var(--color-chart-1)"
          strokeWidth={2.25}
          dot={false}
          activeDot={{
            r: 4,
            stroke: "var(--color-background)",
            strokeWidth: 2,
          }}
          isAnimationActive
          animationDuration={600}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
