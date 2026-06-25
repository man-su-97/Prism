"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Database,
  LayoutDashboard,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { Card } from "@/components/ui/card";
import { fadeUpSmall, staggerParent } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Accent = "lime" | "teal" | "violet";

const ACCENT_GRADIENT: Record<Accent, string> = {
  lime:   "from-(--brand-from) to-(--brand-via)",                          /* Lime→Teal */
  teal:   "from-(--brand-via) to-(--brand-to)",                            /* Teal→Violet */
  violet: "from-(--brand-from) via-(--brand-via) to-(--brand-to)",         /* Full brand */
};

// Accent-tinted shadow on the icon badge — uses IO token references.
const ACCENT_BADGE_SHADOW: Record<Accent, string> = {
  lime:   "shadow-[0_6px_18px_-6px_oklch(from_var(--color-lime)_l_c_h/0.55)]",
  teal:   "shadow-[0_6px_18px_-6px_oklch(from_var(--color-teal)_l_c_h/0.55)]",
  violet: "shadow-[0_6px_18px_-6px_oklch(from_var(--color-violet)_l_c_h/0.55)]",
};

type Tile = {
  label: string;
  href: string;
  icon: LucideIcon;
  accent: Accent;
} & (
  | { kind: "count"; value: number; hint: string }
  | { kind: "plan"; planName: string; used: number; cap: number }
);

export function StatTiles({
  datasetCount,
  dashboardCount,
  planName,
  datasetCap,
}: {
  datasetCount: number;
  dashboardCount: number;
  planName: string;
  datasetCap: number;
}) {
  const tiles: Tile[] = [
    {
      kind: "count",
      label: "Dashboards",
      href: "/dashboards",
      icon: LayoutDashboard,
      value: dashboardCount,
      hint: dashboardCount === 1 ? "live dashboard" : "live dashboards",
      accent: "violet",
    },
    {
      kind: "count",
      label: "Datasets",
      href: "/datasets",
      icon: Database,
      value: datasetCount,
      hint: datasetCount === 1 ? "connected source" : "connected sources",
      accent: "teal",
    },
    {
      kind: "plan",
      label: "Plan",
      href: "/settings/billing",
      icon: Sparkles,
      planName,
      used: datasetCount,
      cap: datasetCap,
      accent: "lime",
    },
  ];

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
      {tiles.map((t) => (
        <motion.div key={t.label} variants={fadeUpSmall}>
          <TileCard tile={t} />
        </motion.div>
      ))}
    </motion.div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const accent = tile.accent;
  const ariaLabel =
    tile.kind === "count"
      ? `${tile.label}: ${tile.value}`
      : `${tile.label}: ${tile.planName}, ${tile.used} of ${tile.cap} datasets`;

  return (
    <Link
      href={tile.href}
      className="group block h-full focus-visible:outline-none"
      aria-label={ariaLabel}
    >
      <Card
        className={cn(
          "relative isolate flex h-full flex-col gap-0 overflow-hidden py-0 transition-all duration-300",
          "ring-foreground/10 hover:ring-foreground/20",
          "hover:-translate-y-1 hover:shadow-(--shadow-elevated)",
          "group-focus-visible:ring-primary/40 group-focus-visible:ring-2",
        )}
      >
        {/* Top-right gradient halo — bigger and softer than before. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-24 -right-20 -z-10 size-64 rounded-full bg-linear-to-br opacity-30 blur-3xl transition-all duration-500",
            "group-hover:opacity-50 group-hover:scale-110",
            ACCENT_GRADIENT[accent],
          )}
        />
        {/* Hairline accent on the top edge in the same accent. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r opacity-60",
            ACCENT_GRADIENT[accent],
          )}
        />
        {/* Shimmer sweep on hover. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100",
            "bg-[linear-gradient(115deg,transparent_30%,oklch(from_var(--foreground)_l_c_h/0.04)_50%,transparent_70%)]",
          )}
        />

        <div className="relative flex items-center justify-between px-5 pt-5">
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-xl text-white",
              "bg-linear-to-br transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3",
              ACCENT_GRADIENT[accent],
              ACCENT_BADGE_SHADOW[accent],
            )}
          >
            <tile.icon className="size-4.5" />
          </span>
          <span
            className={cn(
              "text-muted-foreground inline-flex size-7 items-center justify-center rounded-full",
              "border border-foreground/10 bg-background/70 backdrop-blur",
              "transition-all duration-300",
              "translate-x-1 opacity-0",
              "group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-foreground",
            )}
          >
            <ArrowUpRight className="size-3.5" />
          </span>
        </div>

        <div className="relative flex flex-1 flex-col px-5 pt-4 pb-5">
          <div className="text-muted-foreground text-xs font-medium uppercase tracking-[0.14em] md:text-[11px]">
            {tile.label}
          </div>
          {tile.kind === "count" ? (
            <>
              <div className="mt-2 text-4xl font-medium tracking-tight tabular-nums text-foreground">
                <AnimatedNumber value={tile.value} />
              </div>
              <p className="text-muted-foreground mt-auto pt-1.5 text-xs">
                {tile.hint}
              </p>
            </>
          ) : (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span
                  className={cn(
                    "bg-linear-to-br bg-clip-text text-3xl font-medium tracking-tight text-transparent",
                    ACCENT_GRADIENT[accent],
                  )}
                >
                  {tile.planName}
                </span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {tile.used.toLocaleString()} / {tile.cap.toLocaleString()}
                </span>
              </div>
              <div className="mt-auto pt-3">
                <div className="bg-muted/80 h-1.5 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full bg-linear-to-r transition-[width] duration-700 ease-out",
                      ACCENT_GRADIENT[accent],
                    )}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          tile.cap > 0 ? (tile.used / tile.cap) * 100 : 0,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  datasets used this plan
                </p>
              </div>
            </>
          )}
        </div>
      </Card>
    </Link>
  );
}
