"use client";

import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanLimits, PlanResponse } from "@/lib/billing";
import { cn } from "@/lib/utils";

import type { UpgradeReason } from "./UpgradePromptProvider";

const PLAN_ORDER: Record<string, number> = { free: 0, pro: 1, team: 2 };

function rank(name: string): number {
  return PLAN_ORDER[name.toLowerCase()] ?? 99;
}

export function UpgradePromptDialog({
  open,
  plan,
  reason,
  onOpenChange,
}: {
  open: boolean;
  plan: PlanResponse | null;
  reason: UpgradeReason | null;
  onOpenChange: (open: boolean) => void;
}) {
  const currentName = plan?.plan.name ?? null;
  const currentRank = currentName ? rank(currentName) : -1;
  const sortedPlans = plan?.available_plans
    ? [...plan.available_plans].sort((a, b) => rank(a.name) - rank(b.name))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) inline-flex size-6 items-center justify-center rounded-lg text-white">
              <Sparkles className="size-3.5" />
            </span>
            Upgrade your plan
          </DialogTitle>
          <DialogDescription>
            Unlock more datasets, widgets, and AI messages.
          </DialogDescription>
        </DialogHeader>

        {reason ? (
          <div className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2.5 text-xs">
            <div className="font-medium text-foreground">{reason.message}</div>
            <div className="mt-0.5 text-muted-foreground">
              Pick a higher tier below to keep going.
            </div>
          </div>
        ) : null}

        {plan === null ? (
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">
              We couldn&apos;t load your current plan info. Manage your
              subscription on the billing page.
            </p>
            <Button asChild onClick={() => onOpenChange(false)}>
              <Link href="/settings/billing">
                Open Billing
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {sortedPlans.map((p) => (
              <PlanCard
                key={p.name}
                plan={p}
                isCurrent={p.name.toLowerCase() === currentName?.toLowerCase()}
                isDowngrade={rank(p.name) < currentRank}
                onClose={() => onOpenChange(false)}
              />
            ))}
          </div>
        )}

        <DialogFooter className="sm:items-center">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button asChild onClick={() => onOpenChange(false)}>
            <Link href="/settings/billing">
              Compare all plans
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({
  plan,
  isCurrent,
  isDowngrade,
  onClose,
}: {
  plan: PlanLimits;
  isCurrent: boolean;
  isDowngrade: boolean;
  onClose: () => void;
}) {
  const cta = isCurrent
    ? "Current plan"
    : isDowngrade
      ? "Switch in Billing"
      : plan.monthly_price_usd === 0
        ? "Use Free plan"
        : `Upgrade to ${plan.name}`;

  return (
    <Card
      className={cn(
        "relative flex flex-col gap-3 p-4",
        isCurrent ? "border-primary/60 shadow-sm" : null,
      )}
    >
      {isCurrent ? (
        <Badge className="absolute right-2 top-2" variant="secondary">
          Current
        </Badge>
      ) : null}
      <CardHeader className="p-0">
        <CardTitle className="capitalize text-sm">{plan.name}</CardTitle>
        <CardDescription className="text-foreground">
          {plan.monthly_price_usd === 0 ? (
            <span className="text-lg font-semibold">Free</span>
          ) : (
            <>
              <span className="text-lg font-semibold">
                ${plan.monthly_price_usd}
              </span>
              <span className="text-muted-foreground text-xs"> / month</span>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ul className="space-y-1.5 text-xs">
          <Feature>
            {plan.max_datasets} datasets · {plan.row_cap.toLocaleString()} rows
            each
          </Feature>
          <Feature>
            {plan.max_widgets_per_dashboard} widgets per dashboard
          </Feature>
          <Feature>
            {plan.max_dashboards_per_dataset} dashboards per dataset
          </Feature>
          <Feature>
            {plan.chat_tokens_per_month} AI messages / month
          </Feature>
          <Feature>{plan.chat_per_hour} messages / hour burst</Feature>
          <Feature>
            {plan.max_workspaces === 1
              ? "1 workspace"
              : `Up to ${plan.max_workspaces} workspaces`}
          </Feature>
        </ul>
      </CardContent>
      <CardFooter className="border-0 bg-transparent p-0 pb-4">
        <Button
          asChild
          variant={isCurrent || isDowngrade ? "outline" : "default"}
          size="sm"
          className="w-full"
          disabled={isCurrent}
        >
          {isCurrent ? (
            <span>{cta}</span>
          ) : (
            <Link href="/settings/billing" onClick={onClose}>
              {cta}
            </Link>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <Check className="text-success mt-0.5 size-3 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
