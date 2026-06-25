"use client";

import { LayoutGrid, List, Search, X } from "lucide-react";
import { motion } from "framer-motion";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list";

export function ListToolbar({
  view,
  onViewChange,
  query,
  onQueryChange,
  placeholder = "Search…",
  shown,
  total,
  itemNoun = "record",
  children,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  placeholder?: string;
  shown: number;
  total: number;
  itemNoun?: string;
  children?: React.ReactNode;
}) {
  const filtered = shown !== total;
  const pluralTotal = `${itemNoun}${total === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            aria-label="Search"
            className={cn(
              "h-9 rounded-full pl-9 pr-9 md:pl-9 md:pr-9 transition-shadow",
              "focus-visible:shadow-[0_0_0_4px_oklch(from_var(--primary)_l_c_h/0.12)]",
            )}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange("")}
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-muted absolute top-1/2 right-2 -translate-y-1/2",
                "flex size-6 items-center justify-center rounded-full transition-colors",
              )}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        {children}
      </div>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "text-muted-foreground font-mono text-xs tabular-nums",
            filtered && "text-foreground font-medium",
          )}
        >
          {filtered ? `${shown} of ${total} ${pluralTotal}` : `Total ${total} ${pluralTotal}`}
        </span>
        <div
          className={cn(
            "relative inline-flex items-center rounded-full border border-border bg-muted/40 p-1",
            "shadow-[inset_0_1px_0_oklch(from_var(--foreground)_l_c_h/0.04)]",
          )}
        >
          {(["grid", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              aria-label={mode === "grid" ? "Grid view" : "List view"}
              onClick={() => onViewChange(mode)}
              className={cn(
                "relative inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors",
                view === mode && "text-foreground",
              )}
            >
              {view === mode && (
                <motion.span
                  layoutId="list-toolbar-view-pill"
                  className="absolute inset-0 -z-0 rounded-full bg-background shadow-sm ring-1 ring-border"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative z-10">
                {mode === "grid" ? (
                  <LayoutGrid className="size-3.5" />
                ) : (
                  <List className="size-3.5" />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
