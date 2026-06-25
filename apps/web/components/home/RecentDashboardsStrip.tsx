"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, LayoutDashboard } from "lucide-react";

import { Card } from "@/components/ui/card";
import { fadeUpSmall, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type DashboardItem = {
  id: string;
  name: string;
  kind: string;
  created_at: string;
  dataset_name: string | null;
};

export function RecentDashboardsStrip({ items }: { items: DashboardItem[] }) {
  if (items.length === 0) {
    return (
      <div className="border-border/60 bg-muted/20 flex items-center justify-between gap-3 rounded-2xl border border-dashed px-5 py-6 text-sm">
        <div>
          <p className="font-medium">No dashboards yet</p>
          <p className="text-muted-foreground text-xs">
            Upload a dataset to get an auto-built starter dashboard.
          </p>
        </div>
        <Link
          href="/datasets"
          className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Upload <ArrowRight className="size-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Recent dashboards</h2>
        <Link
          href="/dashboards"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          View all <ArrowRight className="size-3" />
        </Link>
      </div>
      <motion.div
        variants={staggerParent}
        initial="hidden"
        animate="visible"
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-1 scrollbar-thin"
      >
        {items.map((d) => (
          <motion.div
            key={d.id}
            variants={fadeUpSmall}
            className="snap-start shrink-0 basis-72"
          >
            <Link
              href={`/dashboards/${d.id}`}
              className="group block focus-visible:outline-none"
            >
              <Card
                size="sm"
                className={cn(
                  "relative h-full gap-2 overflow-hidden transition-all duration-200",
                  "ring-foreground/8 hover:ring-foreground/15 hover:-translate-y-0.5 hover:shadow-(--shadow-elevated)",
                  "group-focus-visible:ring-primary/40 group-focus-visible:ring-2",
                  "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300",
                  "before:bg-[radial-gradient(120%_80%_at_100%_0%,oklch(from_var(--brand-from)_l_c_h/0.10),transparent_55%)]",
                  "hover:before:opacity-100",
                )}
              >
                <div className="relative flex items-start justify-between gap-2 px-4 pt-4">
                  <span className="bg-(--color-violet-fill) text-(--color-violet) inline-flex size-7 shrink-0 items-center justify-center rounded-lg">
                    <LayoutDashboard className="size-3.5" />
                  </span>
                  <ArrowUpRight
                    className={cn(
                      "text-muted-foreground size-4 shrink-0 transition-all duration-200",
                      "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-hover:text-foreground",
                    )}
                  />
                </div>
                <div className="relative px-4 pb-4">
                  <p className="text-foreground truncate text-sm font-medium" title={d.name}>
                    {d.name}
                  </p>
                  <p
                    className="text-muted-foreground mt-0.5 truncate text-xs"
                    title={d.dataset_name ?? undefined}
                  >
                    {d.dataset_name ?? "—"}
                  </p>
                  <p className="text-muted-foreground mt-2 font-mono text-xs tabular-nums">
                    {new Date(d.created_at).toLocaleDateString()}
                  </p>
                </div>
              </Card>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
