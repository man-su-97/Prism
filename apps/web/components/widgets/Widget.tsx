"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { messageFromUnknown, parseApiError } from "@/lib/errors";

import { BarChartWidget } from "./BarChartWidget";
import { KpiCard } from "./KpiCard";
import { LineChartWidget } from "./LineChartWidget";
import { OverviewCard } from "./OverviewCard";
import { PieChartWidget } from "./PieChartWidget";
import { TableWidget } from "./TableWidget";
import { WidgetCard } from "./WidgetCard";
import type { Widget as WidgetT, WidgetDataResponse } from "./types";

async function fetchData(widgetId: string): Promise<WidgetDataResponse> {
  const res = await fetch(
    `/dashboards/api?path=${encodeURIComponent(`/api/widgets/${widgetId}/data`)}`,
    { method: "POST", cache: "no-store" },
  );
  if (!res.ok) throw new Error(await parseApiError(res));
  return (await res.json()) as WidgetDataResponse;
}

function renderBody(
  widget: WidgetT,
  data: WidgetDataResponse,
  overview: string | null,
) {
  switch (widget.kind) {
    case "kpi":
      return <KpiCard widget={widget} data={data} />;
    case "line":
      return <LineChartWidget widget={widget} data={data} />;
    case "bar":
      return <BarChartWidget widget={widget} data={data} />;
    case "pie":
      return <PieChartWidget widget={widget} data={data} />;
    case "table":
      return <TableWidget widget={widget} data={data} />;
    case "overview":
      return <OverviewCard widget={widget} overview={overview} />;
    default:
      return null;
  }
}

function LoadingBody({ kind }: { kind: WidgetT["kind"] }) {
  if (kind === "kpi") {
    return <Skeleton className="h-9 w-32" />;
  }
  if (kind === "table") {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (kind === "overview") {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-9/12" />
      </div>
    );
  }
  return <Skeleton className="h-full w-full" />;
}

export function WidgetTile({
  widget,
  overview,
  onEdit,
  onDelete,
}: {
  widget: WidgetT;
  overview: string | null;
  onEdit?: (w: WidgetT) => void;
  onDelete?: (w: WidgetT) => void;
}) {
  const [data, setData] = useState<WidgetDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configKey = JSON.stringify(widget.config ?? {});
  useEffect(() => {
    if (widget.kind === "overview") {
      setData({ kind: "overview", rows: [] });
      return;
    }
    setError(null);
    setData(null);
    let cancelled = false;
    fetchData(widget.id)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(messageFromUnknown(e, "Couldn't load this widget."));
      });
    return () => {
      cancelled = true;
    };
  }, [widget.id, widget.kind, configKey]);

  const csvUrl = `/dashboards/api?path=${encodeURIComponent(`/api/widgets/${widget.id}/data.csv`)}`;
  const canExport = widget.kind !== "overview";

  const actions =
    onEdit || onDelete || canExport ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Widget actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {onEdit ? (
            <DropdownMenuItem onClick={() => onEdit(widget)} className="gap-2">
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canExport ? (
            <DropdownMenuItem asChild className="gap-2">
              <a
                href={csvUrl}
                download={`${widget.title.replace(/[^a-zA-Z0-9-_]/g, "_") || "widget"}.csv`}
              >
                <Download className="size-4" />
                Export CSV
              </a>
            </DropdownMenuItem>
          ) : null}
          {onDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (confirm(`Delete "${widget.title}"?`)) onDelete(widget);
                }}
                variant="destructive"
                className="gap-2"
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  if (error) {
    return (
      <WidgetCard title={widget.title} actions={actions} draggable={!!onEdit}>
        <div className="text-destructive flex h-full flex-col items-start justify-center gap-2 text-xs">
          <AlertTriangle className="size-4" />
          <div>{error}</div>
        </div>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard title={widget.title} actions={actions} draggable={!!onEdit}>
      {data ? renderBody(widget, data, overview) : <LoadingBody kind={widget.kind} />}
    </WidgetCard>
  );
}
