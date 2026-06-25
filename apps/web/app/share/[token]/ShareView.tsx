"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { LogoMark } from "@/components/layout/Logo";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { messageFromUnknown, parseApiError } from "@/lib/errors";
import { BarChartWidget } from "@/components/widgets/BarChartWidget";
import { KpiCard } from "@/components/widgets/KpiCard";
import { LineChartWidget } from "@/components/widgets/LineChartWidget";
import { OverviewCard } from "@/components/widgets/OverviewCard";
import { PieChartWidget } from "@/components/widgets/PieChartWidget";
import { TableWidget } from "@/components/widgets/TableWidget";
import { WidgetCard } from "@/components/widgets/WidgetCard";
import type { Widget, WidgetDataResponse } from "@/components/widgets/types";

type Layout = { i: string; x: number; y: number; w: number; h: number };

type SharedDashboard = {
  dashboard_id: string;
  dataset_id: string;
  name: string;
  kind: string;
  layout: Layout[];
  overview: string | null;
  widgets: Widget[];
};

const GRID_COLS = 12;
const ROW_PX = 56;

function renderBody(
  widget: Widget,
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

function ShareWidgetTile({
  token,
  widget,
  overview,
}: {
  token: string;
  widget: Widget;
  overview: string | null;
}) {
  const [data, setData] = useState<WidgetDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (widget.kind === "overview") {
      setData({ kind: "overview", rows: [] });
      return;
    }
    let cancelled = false;
    fetch(`/api/share/${encodeURIComponent(token)}/widgets/${widget.id}/data`, {
      method: "POST",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await parseApiError(res));
        const json = (await res.json()) as WidgetDataResponse;
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(messageFromUnknown(e, "Couldn't load this widget."));
      });
    return () => {
      cancelled = true;
    };
  }, [token, widget.id, widget.kind]);

  if (error) {
    return (
      <WidgetCard title={widget.title}>
        <div className="text-destructive flex h-full flex-col items-start justify-center gap-2 text-xs">
          <AlertTriangle className="size-4" />
          Failed to load widget.
        </div>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard title={widget.title}>
      {data ? (
        renderBody(widget, data, overview)
      ) : (
        <Skeleton className="h-full w-full" />
      )}
    </WidgetCard>
  );
}

export function ShareView({
  token,
  dashboard,
}: {
  token: string;
  dashboard: SharedDashboard;
}) {
  const layoutById = new Map(dashboard.layout.map((l) => [l.i, l] as const));
  const totalHeightRows = dashboard.layout.reduce(
    (max, l) => Math.max(max, l.y + l.h),
    6,
  );

  return (
    <main className="bg-grid bg-muted/20 min-h-screen">
      <header className="bg-background sticky top-0 z-30 border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <LogoMark size={22} />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                {dashboard.name}
              </h1>
              <p className="text-muted-foreground text-xs">
                Prism · shared read-only view
              </p>
            </div>
          </div>
          <Badge variant="outline">Read-only</Badge>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {/* overflow-x-auto lets mobile users scroll the dashboard grid
            rather than clipping widgets that fall outside the viewport */}
        <div className="overflow-x-auto">
        <div
          className="relative min-w-160"
          style={{ height: totalHeightRows * ROW_PX }}
        >
          {dashboard.widgets.map((w, i) => {
            const layout =
              layoutById.get(String(i)) ??
              layoutById.get(w.id) ?? {
                i: w.id,
                x: 0,
                y: i * 4,
                w: 12,
                h: 4,
              };
            const leftPct = (layout.x / GRID_COLS) * 100;
            const widthPct = (layout.w / GRID_COLS) * 100;
            return (
              <div
                key={w.id}
                className="absolute p-1.5"
                style={{
                  left: `${leftPct}%`,
                  top: layout.y * ROW_PX,
                  width: `${widthPct}%`,
                  height: layout.h * ROW_PX,
                }}
              >
                <ShareWidgetTile
                  token={token}
                  widget={w}
                  overview={dashboard.overview}
                />
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </main>
  );
}
