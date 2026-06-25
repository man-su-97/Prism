"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, LayoutDashboard, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WidgetTile } from "@/components/widgets/Widget";
import { messageFromUnknown, parseApiError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { Widget } from "@/components/widgets/types";

import "react-grid-layout/css/styles.css";

type Layout = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Props = {
  dashboardId: string;
  initialLayout: Layout[];
  widgets: Widget[];
  overview: string | null;
  onEdit: (widget: Widget) => void;
  onDelete: (widget: Widget) => void;
  onCreate?: () => void;
};

const COLS = 12;
const ROW_HEIGHT = 56;
const PATCH_DEBOUNCE_MS = 600;

const WidthProvider = dynamic(
  async () => {
    const mod = await import("react-grid-layout");
    const Inner = mod.WidthProvider(mod.Responsive);
    function Wrapped(props: Record<string, unknown>) {
      return <Inner {...(props as Record<string, never>)} />;
    }
    Wrapped.displayName = "WidthAwareGrid";
    return { default: Wrapped };
  },
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/30 h-96 animate-shimmer rounded-xl" />
    ),
  },
);

function isSameLayout(a: Layout[], b: Layout[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((l) => [l.i, l] as const));
  return a.every((l) => {
    const other = byId.get(l.i);
    return (
      other != null &&
      other.x === l.x &&
      other.y === l.y &&
      other.w === l.w &&
      other.h === l.h
    );
  });
}

function SaveBadge({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;
  const config = {
    saving: {
      icon: <Loader2 className="size-3 animate-spin" />,
      label: "Saving layout…",
      cls: "border-primary/30 bg-primary/10 text-primary",
    },
    saved: {
      icon: <Check className="size-3" />,
      label: "Saved",
      cls: "border-success/30 bg-success/10 text-success",
    },
    error: {
      icon: <TriangleAlert className="size-3" />,
      label: "Save failed",
      cls: "border-destructive/30 bg-destructive/10 text-destructive",
    },
  }[status];
  return (
    <Badge variant="outline" className={cn("gap-1", config.cls)}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function DashboardGrid({
  dashboardId,
  initialLayout,
  widgets,
  overview,
  onEdit,
  onDelete,
  onCreate,
}: Props) {
  const [layout, setLayout] = useState<Layout[]>(initialLayout);
  const lastSaved = useRef<Layout[]>(initialLayout);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const layoutWithFallback: Layout[] = useMemo(() => {
    const byId = new Map(layout.map((l) => [l.i, l] as const));
    return widgets.map((w, i) => {
      const found = byId.get(w.id) ?? byId.get(String(i));
      if (found) return { ...found, i: w.id };
      return { i: w.id, x: (i * 4) % 12, y: Infinity, w: 4, h: 4 };
    });
  }, [widgets, layout]);

  const flushPatch = useCallback(
    async (next: Layout[]) => {
      setSaveStatus("saving");
      try {
        const res = await fetch(
          `/dashboards/api?path=${encodeURIComponent(`/api/dashboards/${dashboardId}`)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layout: next }),
          },
        );
        if (!res.ok) throw new Error(await parseApiError(res));
        lastSaved.current = next;
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1200);
      } catch (e) {
        setSaveStatus("error");
        toast.error("Couldn't save dashboard layout", {
          description: messageFromUnknown(e),
        });
      }
    },
    [dashboardId],
  );

  const onLayoutChange = useCallback(
    (next: Layout[]) => {
      const trimmed = next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
      setLayout(trimmed);
      if (isSameLayout(trimmed, lastSaved.current)) return;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void flushPatch(trimmed);
      }, PATCH_DEBOUNCE_MS);
    },
    [flushPatch],
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  if (widgets.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-16 text-center">
        <div className="bg-aurora animate-aurora pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative flex flex-col items-center justify-center gap-3">
          <div className="bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) flex size-12 items-center justify-center rounded-2xl text-white shadow-[0_8px_24px_-6px_oklch(from_var(--primary)_l_c_h/0.35)]">
            <LayoutDashboard className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">No widgets yet</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Add a chart, KPI, or table to start telling a story.
            </p>
          </div>
          {onCreate ? (
            <Button onClick={onCreate} className="mt-2">
              Add widget
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-3 flex h-6 items-center justify-end">
        <SaveBadge status={saveStatus} />
      </div>
      <div className="relative -mx-2 px-2 py-2 sm:-mx-3 sm:px-3">
        {/* Dotted backdrop sits behind the grid. Widget cards are opaque, so
         * the dots only show in the gaps. A radial mask fades them out at the
         * edges so the pattern doesn't fight the page chrome. */}
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-0 opacity-90 mask-[radial-gradient(ellipse_at_center,black,transparent_85%)]"
        />
        <WidthProvider
          className="layout relative"
          layouts={{ lg: layoutWithFallback }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: COLS, md: COLS, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={ROW_HEIGHT}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          draggableHandle=".widget-drag-handle"
          onLayoutChange={onLayoutChange as unknown as (l: Layout[]) => void}
        >
          {widgets.map((w) => (
            <div key={w.id}>
              <WidgetTile
                widget={w}
                overview={overview}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </div>
          ))}
        </WidthProvider>
      </div>
    </div>
  );
}
