"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MessageSquareText, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fadeUpSmall, staggerParent } from "@/lib/motion";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Working late";
}

export function HomeHero({
  name,
  workspaceName,
  primaryDashboardHref,
  hasDashboards,
}: {
  name: string;
  workspaceName: string | null;
  primaryDashboardHref: string | null;
  hasDashboards: boolean;
}) {
  const firstName = name.split(" ")[0] || name;

  return (
    <motion.section
      variants={staggerParent}
      initial="hidden"
      animate="visible"
      className="relative overflow-hidden rounded-3xl border border-border/60"
    >
      {/* Layered backdrop: aurora wash + dot grid + brand-tinted radial */}
      <div className="bg-aurora animate-aurora pointer-events-none absolute inset-0" aria-hidden />
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/50 to-transparent"
        aria-hidden
      />

      <div className="relative px-6 py-10 sm:px-10 sm:py-14">
        <motion.div variants={fadeUpSmall} className="flex flex-col gap-6">
          <div className="text-muted-foreground inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider md:text-[11px]">
            <span className="bg-linear-to-br from-(--brand-from) to-(--brand-to) inline-flex size-4 items-center justify-center rounded-md text-white">
              <Sparkles className="size-2.5" />
            </span>
            {workspaceName ? workspaceName : "Prism"}
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {greeting()},{" "}
              <span className="text-gradient-brand">{firstName}</span>.
            </h1>
            <p className="text-muted-foreground max-w-xl text-sm sm:text-base">
              {hasDashboards
                ? "Pick up where you left off, or upload a new dataset and we'll build the starter dashboard for you."
                : "Upload your first dataset and we'll auto-build a dashboard with KPIs, charts, and an AI summary."}
            </p>
          </div>

          <motion.div variants={fadeUpSmall} className="flex flex-wrap items-center gap-2">
            <Button asChild size="lg" className="rounded-full px-5">
              <Link href="/datasets">
                <Upload className="size-4" />
                Upload dataset
              </Link>
            </Button>
            {primaryDashboardHref ? (
              <Button asChild size="lg" variant="outline" className="rounded-full px-5">
                <Link href={primaryDashboardHref}>
                  <MessageSquareText className="size-4" />
                  Open latest dashboard
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg" variant="outline" className="rounded-full px-5">
                <Link href="/dashboards">View all dashboards</Link>
              </Button>
            )}
          </motion.div>
        </motion.div>
      </div>
    </motion.section>
  );
}
