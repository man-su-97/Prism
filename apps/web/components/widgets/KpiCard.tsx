"use client";

import { AnimatedNumber } from "@/components/motion/AnimatedNumber";

import type { Widget, WidgetDataResponse } from "./types";

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(2) + "K";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function KpiCard({ widget, data }: { widget: Widget; data: WidgetDataResponse }) {
  const row = data.rows[0] ?? {};
  const raw = (row as { value?: unknown }).value;
  const num = toNumberOrNull(raw);
  const label = (widget.config.value_column as string | undefined) ?? "KPI";

  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <span className="inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide bg-(--color-lime-fill) text-(--color-kpi-quality)">
        {label}
      </span>
      <div className="text-(--color-kpi-quality) text-3xl font-medium tracking-tight tabular-nums">
        {num !== null ? (
          <AnimatedNumber value={num} format={formatNumber} />
        ) : raw == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          String(raw)
        )}
      </div>
    </div>
  );
}
