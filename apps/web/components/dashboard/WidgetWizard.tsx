"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpgradePrompt } from "@/components/upgrade/UpgradePromptProvider";
import { buildApiError, LimitError, messageFromUnknown } from "@/lib/errors";
import { BarChartWidget } from "@/components/widgets/BarChartWidget";
import { KpiCard } from "@/components/widgets/KpiCard";
import { LineChartWidget } from "@/components/widgets/LineChartWidget";
import { PieChartWidget } from "@/components/widgets/PieChartWidget";
import { TableWidget } from "@/components/widgets/TableWidget";
import type {
  Widget,
  WidgetDataResponse,
  WidgetKind,
} from "@/components/widgets/types";

type Column = { name: string; kind: string; dtype: string };

type FormState = {
  kind: WidgetKind;
  title: string;
  x: string;
  y: string;
  aggregate: string;
  label: string;
  value: string;
  time_bucket: string;
  limit: number;
};

type Mode =
  | { type: "create"; dashboardId: string; datasetId: string }
  | { type: "edit"; widget: Widget; dashboardId: string; datasetId: string };

const KIND_OPTIONS: { value: WidgetKind; label: string }[] = [
  { value: "kpi", label: "KPI card" },
  { value: "line", label: "Line chart" },
  { value: "bar", label: "Bar chart" },
  { value: "pie", label: "Pie chart" },
  { value: "table", label: "Table" },
];

const AGGREGATE_OPTIONS = ["SUM", "AVG", "COUNT", "MIN", "MAX"];
const TIME_BUCKETS = ["day", "week", "month", "quarter", "year"];

const DEFAULT_FORM: FormState = {
  kind: "kpi",
  title: "New KPI",
  x: "",
  y: "",
  aggregate: "SUM",
  label: "",
  value: "",
  time_bucket: "day",
  limit: 25,
};

function formFromWidget(widget: Widget): FormState {
  const cfg = widget.config ?? {};
  return {
    kind: widget.kind as WidgetKind,
    title: widget.title,
    x: (cfg.x as string) ?? "",
    y: (cfg.y as string) ?? (cfg.column as string) ?? "",
    aggregate: ((cfg.aggregate as string) ?? "SUM").toUpperCase(),
    label: (cfg.label as string) ?? "",
    value: (cfg.value as string) ?? "",
    time_bucket: (cfg.time_bucket as string) ?? "day",
    limit: typeof cfg.limit === "number" ? (cfg.limit as number) : 25,
  };
}

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/dashboards/api?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  // buildApiError returns a LimitError on 402 (per-dashboard widget cap on
  // the create POST) so the catch can pop the upgrade dialog. Preview/PATCH
  // never 402 — they get a regular Error.
  if (!res.ok) throw await buildApiError(res);
  const text = await res.text();
  return JSON.parse(text || "null") as T;
}

const NONE = "__none__";

function ColumnSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Column[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || NONE}
        onValueChange={(v) => onChange(v === NONE ? "" : v)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            {placeholder ?? "—"}
          </SelectItem>
          {options.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PlainSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="capitalize">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((a) => (
            <SelectItem key={a} value={a} className="capitalize">
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PreviewSkeleton({ kind }: { kind: WidgetKind }) {
  if (kind === "kpi") {
    return (
      <div className="flex h-full flex-col justify-center gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }
  if (kind === "table") {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-4" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (kind === "bar") {
    const heights = [45, 70, 55, 80, 38, 62, 50, 28];
    return (
      <div className="flex h-72 flex-col gap-2">
        <div className="flex flex-1 items-end gap-2">
          {heights.map((h, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-sm"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <Skeleton className="h-2 w-full" />
      </div>
    );
  }
  if (kind === "pie") {
    return (
      <div className="flex h-72 items-center justify-center gap-6">
        <Skeleton className="size-44 rounded-full" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="size-3 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  const points = [40, 32, 36, 20, 24, 12, 18, 8, 14];
  return (
    <div className="flex h-72 flex-col gap-2">
      <div className="bg-muted/40 relative flex-1 overflow-hidden rounded-md">
        <svg
          viewBox="0 0 100 50"
          preserveAspectRatio="none"
          className="text-muted-foreground/50 size-full animate-pulse"
          aria-hidden
        >
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            points={points
              .map((y, i) => `${(i * 100) / (points.length - 1)},${y}`)
              .join(" ")}
          />
        </svg>
      </div>
      <Skeleton className="h-2 w-full" />
    </div>
  );
}

export function WidgetWizard({
  mode,
  columns,
  onClose,
  onSaved,
}: {
  mode: Mode;
  columns: Column[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    mode.type === "edit" ? formFromWidget(mode.widget) : DEFAULT_FORM,
  );
  const [preview, setPreview] = useState<WidgetDataResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { openUpgrade } = useUpgradePrompt();

  const numericCols = useMemo(
    () => columns.filter((c) => c.kind === "numeric" || c.kind === "id"),
    [columns],
  );
  const datetimeCols = useMemo(
    () => columns.filter((c) => c.kind === "datetime"),
    [columns],
  );
  const categoricalCols = useMemo(
    () =>
      columns.filter((c) =>
        ["categorical", "text", "id", "boolean"].includes(c.kind),
      ),
    [columns],
  );

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // Clear synchronously so the skeleton (not a stale error) paints during
    // the debounce + fetch window after any form change.
    setPreviewError(null);
    setPreview(null);
    debounceTimer.current = setTimeout(async () => {
      try {
        const body = {
          dashboard_id: mode.dashboardId,
          kind: form.kind,
          title: form.title || "Preview",
          x: form.x || null,
          y: form.y || null,
          aggregate: form.aggregate,
          label: form.label || null,
          value: form.value || null,
          time_bucket: form.time_bucket,
          limit: form.limit,
        };
        const res = await jsonFetch<{
          kind: WidgetKind;
          rows: Record<string, unknown>[];
          config: Record<string, unknown>;
        }>("/api/widgets/preview", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setPreview({ kind: res.kind, rows: res.rows, config: res.config });
      } catch (e) {
        setPreviewError(messageFromUnknown(e, "Couldn't preview the widget."));
        setPreview(null);
      }
    }, 350);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [form, mode.dashboardId]);

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        dashboard_id: mode.dashboardId,
        kind: form.kind,
        title: form.title,
        x: form.x || null,
        y: form.y || null,
        aggregate: form.aggregate,
        label: form.label || null,
        value: form.value || null,
        time_bucket: form.time_bucket,
        limit: form.limit,
      };
      if (mode.type === "create") {
        await jsonFetch("/api/widgets", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        await jsonFetch(`/api/widgets/${mode.widget.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (e) {
      if (e instanceof LimitError) {
        setSaving(false);
        openUpgrade({ code: e.code, message: e.message });
        return;
      }
      setSaveError(messageFromUnknown(e, "Couldn't save the widget."));
    } finally {
      setSaving(false);
    }
  }

  const previewWidget: Widget = useMemo(
    () => ({
      id: "preview",
      kind: form.kind,
      title: form.title || "Preview",
      config: (preview?.config as Record<string, unknown>) ?? {},
    }),
    [form.kind, form.title, preview],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {mode.type === "create" ? "Add widget" : `Edit · ${mode.widget.title}`}
          </DialogTitle>
          <DialogDescription>
            Pick a chart kind and the columns to plot. Preview updates as you
            change inputs.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)]">
          <section className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kind">Chart kind</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => set("kind", v as WidgetKind)}
              >
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.kind === "kpi" ? (
              <>
                <ColumnSelect
                  id="kpi-col"
                  label="Column"
                  value={form.y}
                  onChange={(v) => set("y", v)}
                  options={numericCols}
                  placeholder="(row count)"
                />
                <PlainSelect
                  id="kpi-agg"
                  label="Aggregate"
                  value={form.aggregate}
                  onChange={(v) => set("aggregate", v)}
                  options={AGGREGATE_OPTIONS}
                />
              </>
            ) : null}

            {form.kind === "line" ? (
              <>
                <ColumnSelect
                  id="line-x"
                  label="X (datetime)"
                  value={form.x}
                  onChange={(v) => set("x", v)}
                  options={datetimeCols}
                />
                <ColumnSelect
                  id="line-y"
                  label="Y (numeric)"
                  value={form.y}
                  onChange={(v) => set("y", v)}
                  options={numericCols}
                />
                <PlainSelect
                  id="line-agg"
                  label="Aggregate"
                  value={form.aggregate}
                  onChange={(v) => set("aggregate", v)}
                  options={AGGREGATE_OPTIONS}
                />
                <PlainSelect
                  id="line-bucket"
                  label="Time bucket"
                  value={form.time_bucket}
                  onChange={(v) => set("time_bucket", v)}
                  options={TIME_BUCKETS}
                />
              </>
            ) : null}

            {form.kind === "bar" ? (
              <>
                <ColumnSelect
                  id="bar-x"
                  label="X (category)"
                  value={form.x}
                  onChange={(v) => set("x", v)}
                  options={categoricalCols}
                />
                <ColumnSelect
                  id="bar-y"
                  label="Y (numeric)"
                  value={form.y}
                  onChange={(v) => set("y", v)}
                  options={numericCols}
                />
                <PlainSelect
                  id="bar-agg"
                  label="Aggregate"
                  value={form.aggregate}
                  onChange={(v) => set("aggregate", v)}
                  options={AGGREGATE_OPTIONS}
                />
                <div className="space-y-2">
                  <Label htmlFor="bar-top">Top N</Label>
                  <Input
                    id="bar-top"
                    type="number"
                    min={1}
                    max={100}
                    value={form.limit}
                    onChange={(e) => set("limit", Number(e.target.value))}
                  />
                </div>
              </>
            ) : null}

            {form.kind === "pie" ? (
              <>
                <ColumnSelect
                  id="pie-label"
                  label="Label (category)"
                  value={form.label}
                  onChange={(v) => set("label", v)}
                  options={categoricalCols}
                />
                <ColumnSelect
                  id="pie-value"
                  label="Value (optional numeric)"
                  value={form.value}
                  onChange={(v) => set("value", v)}
                  options={numericCols}
                  placeholder="(row count)"
                />
                {form.value ? (
                  <PlainSelect
                    id="pie-agg"
                    label="Aggregate"
                    value={form.aggregate}
                    onChange={(v) => set("aggregate", v)}
                    options={AGGREGATE_OPTIONS}
                  />
                ) : null}
              </>
            ) : null}

            {form.kind === "table" ? (
              <div className="space-y-2">
                <Label htmlFor="table-limit">Row limit</Label>
                <Input
                  id="table-limit"
                  type="number"
                  min={1}
                  max={1000}
                  value={form.limit}
                  onChange={(e) => set("limit", Number(e.target.value))}
                />
              </div>
            ) : null}
          </section>

          <section className="flex min-h-[280px] flex-col">
            <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
              Preview
            </div>
            <div className="bg-muted/30 relative flex-1 overflow-hidden rounded-xl border border-dashed p-3">
              {!preview ? (
                <div className="flex h-full flex-col gap-3">
                  <div className="flex-1">
                    <PreviewSkeleton kind={form.kind} />
                  </div>
                  {previewError ? (
                    <p className="text-destructive text-xs">{previewError}</p>
                  ) : null}
                </div>
              ) : preview.rows.length === 0 ? (
                <p className="text-muted-foreground text-xs">No rows returned.</p>
              ) : form.kind === "kpi" ? (
                <KpiCard widget={previewWidget} data={preview} />
              ) : form.kind === "line" ? (
                <div className="h-72">
                  <LineChartWidget widget={previewWidget} data={preview} />
                </div>
              ) : form.kind === "bar" ? (
                <div className="h-72">
                  <BarChartWidget widget={previewWidget} data={preview} />
                </div>
              ) : form.kind === "pie" ? (
                <div className="h-72">
                  <PieChartWidget widget={previewWidget} data={preview} />
                </div>
              ) : (
                <div className="max-h-72 overflow-auto">
                  <TableWidget widget={previewWidget} data={preview} />
                </div>
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="sm:items-center">
          {saveError ? (
            <span className="text-destructive mr-auto text-xs">{saveError}</span>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={onSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving
              ? "Saving…"
              : mode.type === "create"
                ? "Add widget"
                : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
