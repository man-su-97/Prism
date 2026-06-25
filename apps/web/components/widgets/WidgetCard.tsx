"use client";

import { GripVertical } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  actions?: React.ReactNode;
  /** When true, render the drag-handle icon. Adds the `widget-drag-handle`
   * class so react-grid-layout treats the header as the only draggable area. */
  draggable?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
};

export function WidgetCard({
  title,
  actions,
  draggable = false,
  className,
  bodyClassName,
  children,
}: Props) {
  return (
    <Card
      className={cn(
        "group relative flex h-full flex-col overflow-hidden",
        "ring-foreground/8 transition-shadow duration-200",
        "hover:shadow-[var(--shadow-soft)] hover:ring-foreground/14",
        // Subtle violet accent strip at the top — visible on hover only
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px",
        "before:bg-linear-to-r before:from-transparent before:via-primary/60 before:to-transparent",
        "before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100",
        className,
      )}
    >
      <CardHeader
        className={cn(
          "flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-3.5",
          draggable ? "widget-drag-handle cursor-grab active:cursor-grabbing" : undefined,
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {draggable ? (
            <GripVertical
              className={cn(
                "text-muted-foreground/60 size-3.5 -ml-1 transition-opacity",
                "opacity-0 group-hover:opacity-100",
              )}
            />
          ) : null}
          <CardTitle className="text-muted-foreground truncate text-xs font-medium uppercase tracking-wider md:text-[11px]">
            {title}
          </CardTitle>
        </div>
        {actions ? (
          <div
            className="flex shrink-0 items-center gap-1"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </CardHeader>
      <CardContent
        className={cn("min-h-0 flex-1 px-4 pb-5 pt-1", bodyClassName)}
      >
        {children}
      </CardContent>
    </Card>
  );
}
