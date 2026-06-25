"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Database,
  LayoutDashboard,
  Sparkles,
  Wrench,
} from "lucide-react";

import { fadeUpSmall } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type DashboardCardItem = {
  id: string;
  dataset_id: string;
  name: string;
  kind: string;
  created_at: string;
};

/* Full-bleed painterly chart that fills the entire card.
 * Two flavors: a flowing area-line for auto dashboards, packed bars for manual.
 * The "featured" variant pumps up scale and decoration without changing the
 * visual language. */
function PosterChart({
  kind,
  featured,
}: {
  kind: string;
  featured: boolean;
}) {
  const isManual = kind === "manual";
  const gradientId = `dash-area-${isManual ? "m" : "a"}-${featured ? "f" : "s"}`;

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {/* Saturated brand wash — conic so the angle changes across cards visually */}
      <div
        className={cn(
          "absolute inset-0",
          "bg-[conic-gradient(from_220deg_at_30%_30%,oklch(from_var(--brand-from)_l_c_h/0.55),oklch(from_var(--brand-via)_l_c_h/0.30)_38%,oklch(from_var(--brand-to)_l_c_h/0.55)_70%,oklch(from_var(--brand-from)_l_c_h/0.45))]",
          "transition-[filter,transform] duration-700 ease-out",
          "group-hover:scale-[1.03] group-hover:[filter:saturate(1.15)_brightness(1.05)]",
        )}
      />

      {/* engineering grid */}
      <div
        className={cn(
          "absolute inset-0 opacity-[0.18]",
          "[background-image:linear-gradient(oklch(from_var(--card)_l_c_h/0.9)_1px,transparent_1px),linear-gradient(90deg,oklch(from_var(--card)_l_c_h/0.9)_1px,transparent_1px)]",
          featured ? "[background-size:36px_36px]" : "[background-size:22px_22px]",
        )}
      />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 600 450"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="oklch(from var(--brand-from) l c h / 0.65)"
            />
            <stop
              offset="100%"
              stopColor="oklch(from var(--brand-from) l c h / 0.0)"
            />
          </linearGradient>
          <filter id={`${gradientId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {isManual ? (
          <g>
            {[
              { x: 30, h: 130 },
              { x: 78, h: 210 },
              { x: 126, h: 160 },
              { x: 174, h: 270 },
              { x: 222, h: 110 },
              { x: 270, h: 190 },
              { x: 318, h: 250 },
              { x: 366, h: 145 },
              { x: 414, h: 225 },
              { x: 462, h: 175 },
              { x: 510, h: 260 },
              { x: 558, h: 200 },
            ].map((b, i) => (
              <rect
                key={i}
                x={b.x}
                y={380 - b.h}
                width={30}
                height={b.h}
                rx={6}
                className="transition-transform duration-500 ease-out group-hover:[transform-origin:center_bottom] group-hover:[transform:scaleY(1.08)]"
                style={{
                  fill: `oklch(from var(--brand-via) l c h / ${0.55 + (i % 3) * 0.1})`,
                  transitionDelay: `${i * 22}ms`,
                }}
              />
            ))}
          </g>
        ) : (
          <g>
            <path
              d="M0 320 C 80 270 160 340 220 240 S 380 110 460 160 S 560 220 600 180 L 600 450 L 0 450 Z"
              fill={`url(#${gradientId})`}
            />
            {/* glow underlay for line */}
            <path
              d="M0 320 C 80 270 160 340 220 240 S 380 110 460 160 S 560 220 600 180"
              className="stroke-[oklch(from_var(--brand-from)_l_c_h/0.9)]"
              strokeWidth={6}
              fill="none"
              filter={`url(#${gradientId}-glow)`}
              opacity={0.65}
            />
            {/* primary line */}
            <path
              d="M0 320 C 80 270 160 340 220 240 S 380 110 460 160 S 560 220 600 180"
              className="stroke-[oklch(from_var(--brand-from)_l_c_h/1)]"
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
            />
            {/* secondary dashed ghost line */}
            <path
              d="M0 360 C 80 340 160 350 240 310 S 400 230 480 270 S 580 290 600 270"
              className="stroke-[oklch(from_var(--brand-to)_l_c_h/0.55)]"
              strokeWidth={1.5}
              fill="none"
              strokeDasharray="5 6"
            />
            {[
              { x: 100, y: 295 },
              { x: 220, y: 240 },
              { x: 360, y: 140 },
              { x: 460, y: 160 },
              { x: 560, y: 195 },
            ].map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={featured ? 11 : 8}
                  className="fill-[oklch(from_var(--brand-from)_l_c_h/0.25)]"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={featured ? 5 : 4}
                  className="fill-card stroke-[oklch(from_var(--brand-from)_l_c_h/1)]"
                  strokeWidth={2}
                />
              </g>
            ))}
          </g>
        )}
      </svg>

      {/* glossy highlight sweep — moves on hover */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100",
          "bg-[linear-gradient(115deg,transparent_30%,oklch(from_var(--card)_l_c_h/0.18)_45%,transparent_60%)]",
        )}
      />

      {/* bottom scrim into card color so overlaid text is readable in both themes */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0",
          featured ? "h-3/5" : "h-2/3",
          "bg-gradient-to-t from-card via-card/90 to-transparent",
        )}
      />

      {/* top edge sheen */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[oklch(from_var(--card)_l_c_h/0.45)]" />
    </div>
  );
}

function KindChip({ kind }: { kind: string }) {
  const isManual = kind === "manual";
  const Icon = isManual ? Wrench : Sparkles;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
        "border bg-card/85 text-xs font-semibold uppercase tracking-[0.08em] backdrop-blur-md",
        "shadow-[0_2px_8px_-3px_oklch(from_var(--foreground)_l_c_h/0.18)]",
        isManual
          ? "border-border/70 text-muted-foreground"
          : "border-primary/35 text-primary",
      )}
    >
      <Icon className="size-3" />
      {kind}
    </span>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const day = 86_400_000;
  if (diff < day) {
    const hours = Math.max(1, Math.round(diff / 3_600_000));
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (diff < 7 * day) {
    const d = Math.round(diff / day);
    return d === 1 ? "yesterday" : `${d} days ago`;
  }
  if (diff < 30 * day) {
    const w = Math.round(diff / (7 * day));
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DashboardCard({
  dashboard,
  datasetName,
  featured = false,
}: {
  dashboard: DashboardCardItem;
  datasetName: string | undefined;
  featured?: boolean;
}) {
  return (
    <motion.div
      variants={fadeUpSmall}
      layout
      className={cn(
        "h-full min-h-[18rem]",
        featured && "sm:col-span-2 sm:row-span-2",
      )}
    >
      <Link
        href={`/dashboards/${dashboard.id}`}
        className="group block h-full focus-visible:outline-none"
      >
        <article
          className={cn(
            "bg-card relative h-full w-full overflow-hidden rounded-2xl",
            "ring-foreground/8 ring-1 ring-inset",
            "shadow-[0_1px_2px_-1px_oklch(from_var(--foreground)_l_c_h/0.08)]",
            "transition-all duration-300 ease-out",
            "hover:ring-primary/30 hover:-translate-y-0.5",
            "hover:shadow-[0_18px_42px_-18px_oklch(from_var(--primary)_l_c_h/0.45)]",
            "group-focus-visible:ring-primary/50 group-focus-visible:ring-2",
          )}
        >
          <PosterChart kind={dashboard.kind} featured={featured} />

          {/* Top chrome: kind chip left, arrow indicator right */}
          <div className="relative z-10 flex items-start justify-between gap-2 p-3">
            <KindChip kind={dashboard.kind} />
            <span
              className={cn(
                "bg-card/85 text-muted-foreground inline-flex size-7 items-center justify-center rounded-full border border-border/70 backdrop-blur-md",
                "shadow-[0_2px_8px_-3px_oklch(from_var(--foreground)_l_c_h/0.18)]",
                "transition-all duration-300",
                "group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary group-hover:-rotate-12",
              )}
            >
              <ArrowUpRight className="size-3.5" />
            </span>
          </div>

          {/* Bottom title block — sits over the scrim */}
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2",
              featured ? "gap-3 p-5" : "p-3.5",
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "bg-(--color-violet-fill) text-(--color-violet) ring-(--color-violet)/20 flex shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                  "transition-all duration-300 group-hover:scale-[1.04] group-hover:bg-(--color-violet-fill)/80 group-hover:ring-(--color-violet)/35",
                  featured ? "size-11" : "size-9",
                )}
              >
                <LayoutDashboard className={featured ? "size-5" : "size-4"} />
              </span>
              <div className="min-w-0 flex-1">
                <h3
                  className={cn(
                    "text-foreground truncate leading-tight tracking-tight",
                    featured
                      ? "text-xl sm:text-2xl font-semibold"
                      : "text-base font-medium",
                  )}
                >
                  {dashboard.name}
                </h3>
                <div
                  className={cn(
                    "mt-1.5 flex flex-wrap items-center gap-1.5",
                    "text-xs",
                  )}
                >
                  {datasetName ? (
                    <span className="bg-muted/60 text-muted-foreground inline-flex max-w-[14rem] items-center gap-1 rounded-md px-1.5 py-0.5">
                      <Database className="size-3 shrink-0 opacity-70" />
                      <span className="truncate" title={datasetName}>
                        {datasetName}
                      </span>
                    </span>
                  ) : null}
                  <span className="text-muted-foreground font-mono tabular-nums">
                    · {relativeTime(dashboard.created_at)}
                  </span>
                </div>
              </div>
            </div>

            {featured ? (
              <div className="flex items-center justify-between border-t border-border/40 pt-3">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.14em] md:text-[11px]">
                  Latest
                </span>
                <span
                  className={cn(
                    "text-(--color-lime) inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em]",
                    "transition-transform duration-200 group-hover:translate-x-0.5",
                  )}
                >
                  Open dashboard
                  <span aria-hidden>→</span>
                </span>
              </div>
            ) : null}
          </div>
        </article>
      </Link>
    </motion.div>
  );
}
