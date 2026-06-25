"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  CalendarDays,
  Database,
  FileSpreadsheet,
  HardDrive,
  LayoutDashboard,
  Rows,
  Sheet,
} from "lucide-react";

import { Card, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/datasets/StatusBadge";
import { fadeUpSmall } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type DatasetCardItem = {
  id: string;
  name: string;
  source_kind: string;
  status: string;
  row_count: number | null;
  size_bytes: number | null;
  created_at: string;
};

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fmtRows(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

type KindMeta = {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  chip: string;
};

const KIND_META: Record<string, KindMeta> = {
  csv: {
    label: "CSV",
    Icon: FileSpreadsheet,
    chip: "border-[var(--color-lime)]/30 bg-[var(--color-lime-fill)] text-[var(--color-lime)]",
  },
  xlsx: {
    label: "XLSX",
    Icon: FileSpreadsheet,
    chip: "border-[var(--color-teal)]/30 bg-[var(--color-teal-fill)] text-[var(--color-teal)]",
  },
  xls: {
    label: "XLS",
    Icon: FileSpreadsheet,
    chip: "border-[var(--color-teal)]/30 bg-[var(--color-teal-fill)] text-[var(--color-teal)]",
  },
  sheet: {
    label: "Sheets",
    Icon: Sheet,
    chip: "border-[var(--color-violet)]/30 bg-[var(--color-violet-fill)] text-[var(--color-violet)]",
  },
};

const FALLBACK_KIND: KindMeta = {
  label: "FILE",
  Icon: FileSpreadsheet,
  chip: "border-border bg-muted text-muted-foreground",
};

function KindChip({ kind }: { kind: string }) {
  const meta = KIND_META[kind] ?? FALLBACK_KIND;
  const { Icon } = meta;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider",
        meta.chip,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight tabular-nums text-foreground">
          {value}
        </div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

export function DatasetCard({
  dataset,
  dashboardId,
}: {
  dataset: DatasetCardItem;
  dashboardId: string | undefined;
}) {
  const canOpenDashboard = !!dashboardId && dataset.status === "ready";
  return (
    <motion.div variants={fadeUpSmall} layout>
      <Link
        href={`/datasets/${dataset.id}`}
        className="group block focus-visible:outline-none"
      >
        <Card
          size="sm"
          className={cn(
            "relative gap-3 overflow-hidden transition-all duration-200",
            "ring-foreground/8 hover:ring-foreground/20 hover:-translate-y-0.5 hover:shadow-(--shadow-elevated)",
            "group-focus-visible:ring-primary/40 group-focus-visible:ring-2",
            "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300",
            "before:bg-[radial-gradient(120%_80%_at_100%_0%,oklch(from_var(--brand-via)_l_c_h/0.10),transparent_55%)]",
            "hover:before:opacity-100",
          )}
        >
          <div className="relative z-10 flex flex-col gap-3 px-3">
            <div className="flex items-center justify-between gap-2">
              <KindChip kind={dataset.source_kind} />
              <StatusBadge status={dataset.status} />
            </div>

            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  "bg-(--color-teal-fill) text-(--color-teal) group-hover:bg-(--color-teal-fill)/80",
                )}
              >
                <Database className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle className="truncate">{dataset.name}</CardTitle>
                <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="size-3 opacity-70" />
                  <span className="font-mono tabular-nums">
                    {new Date(dataset.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <ArrowUpRight
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-all duration-200",
                  "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-hover:text-foreground",
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Rows} label="Rows" value={fmtRows(dataset.row_count)} />
              <Stat
                icon={HardDrive}
                label="Size"
                value={fmtBytes(dataset.size_bytes)}
              />
            </div>

            {canOpenDashboard ? (
              <Link
                href={`/dashboards/${dashboardId}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md border border-border/60 bg-card",
                  "px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors",
                  "hover:border-(--color-lime)/40 hover:bg-(--color-lime-fill) hover:text-(--color-lime)",
                )}
              >
                <LayoutDashboard className="size-3.5" />
                Open dashboard
              </Link>
            ) : null}
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}
