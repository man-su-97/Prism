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

export type SeriesPoint = { bucket: string; value: number };

export function MiniLineChart({ points }: { points: SeriesPoint[] }) {
  const gradientId = useId();
  const data = points.map((p) => ({
    x: p.bucket.slice(5), // MM-DD
    y: p.value,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          opacity={0.5}
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
          allowDecimals={false}
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
        />
        <Area
          type="monotone"
          dataKey="y"
          stroke="none"
          fill={`url(#${gradientId})`}
          isAnimationActive
          animationDuration={650}
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
          animationDuration={650}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
