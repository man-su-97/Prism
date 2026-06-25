"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Sheet as SheetIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type SheetPickerSheet = {
  sheet_id: number;
  title: string;
  row_count: number | null;
  column_count: number | null;
};

function fmtRows(n: number | null): string {
  if (n == null) return "—";
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function SheetPicker({
  sheets,
  busy,
  onConfirm,
  onCancel,
}: {
  sheets: SheetPickerSheet[];
  busy: boolean;
  onConfirm: (titles: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sheets.map((s) => s.title)),
  );

  const allSelected = selected.size === sheets.length;
  const noneSelected = selected.size === 0;

  function toggle(title: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sheets.map((s) => s.title)));
  }

  const ordered = useMemo(
    () => sheets.map((s) => ({ ...s, checked: selected.has(s.title) })),
    [sheets, selected],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Pick the sheets you want to ingest
        </p>
        <button
          type="button"
          onClick={toggleAll}
          disabled={busy}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>

      <ul className="max-h-72 space-y-1 overflow-auto rounded-md border bg-muted/20 p-1">
        {ordered.map((s) => (
          <li key={s.sheet_id}>
            <label
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition",
                "hover:bg-accent",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <Checkbox
                checked={s.checked}
                onCheckedChange={() => toggle(s.title)}
                disabled={busy}
                aria-label={`Include sheet ${s.title}`}
              />
              <SheetIcon className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {s.title}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {fmtRows(s.row_count)} rows · {s.column_count ?? "—"} cols
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground text-xs">
        Selected sheets are stacked into one dataset with a{" "}
        <code className="rounded bg-muted px-1 py-0.5">_sheet</code> column
        tagging each row&apos;s source. Sheets with different headers are
        outer-unioned (missing columns become empty).
      </p>

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button
          type="button"
          onClick={() => onConfirm(Array.from(selected))}
          disabled={busy || noneSelected}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy
            ? "Ingesting…"
            : `Ingest ${selected.size} sheet${selected.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
