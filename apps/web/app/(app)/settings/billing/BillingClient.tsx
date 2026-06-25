"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
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
import { Progress } from "@/components/ui/progress";
import type { PlanLimits, PlanResponse } from "@/lib/billing";
import { messageFromUnknown, parseApiError } from "@/lib/errors";
import { cn } from "@/lib/utils";

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/dashboards/api?path=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const text = await res.text();
  return JSON.parse(text || "null") as T;
}

function PlanCard({
  plan,
  isCurrent,
  onSelect,
  busy,
}: {
  plan: PlanLimits;
  isCurrent: boolean;
  onSelect: (plan: PlanLimits) => void;
  busy: boolean;
}) {
  return (
    <Card
      className={cn(
        "relative flex flex-col",
        isCurrent ? "border-primary shadow-sm" : null,
      )}
    >
      {isCurrent ? (
        <Badge className="absolute right-4 top-4">Current</Badge>
      ) : null}
      <CardHeader>
        <CardTitle className="capitalize">{plan.name}</CardTitle>
        <CardDescription>
          {plan.monthly_price_usd === 0 ? (
            <span className="text-foreground text-2xl font-semibold">Free</span>
          ) : (
            <>
              <span className="text-foreground text-2xl font-semibold">
                ${plan.monthly_price_usd}
              </span>{" "}
              <span className="text-xs">/ month</span>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <Check className="text-success size-4 shrink-0" />
            {plan.max_workspaces === 1
              ? "1 workspace"
              : `Up to ${plan.max_workspaces} workspaces`}
          </li>
          <li className="flex items-center gap-2">
            <Check className="text-success size-4 shrink-0" />
            {plan.max_datasets} datasets
          </li>
          <li className="flex items-center gap-2">
            <Check className="text-success size-4 shrink-0" />
            {plan.row_cap.toLocaleString()} rows / dataset
          </li>
          <li className="flex items-center gap-2">
            <Check className="text-success size-4 shrink-0" />
            {plan.max_widgets_per_dashboard} widgets / dashboard
          </li>
          <li className="flex items-center gap-2">
            <Check className="text-success size-4 shrink-0" />
            {plan.max_dashboards_per_dataset} dashboards / dataset
          </li>
          <li className="flex items-center gap-2">
            <Check className="text-success size-4 shrink-0" />
            {plan.chat_tokens_per_month} chat messages / month
          </li>
          <li className="flex items-center gap-2">
            <Check className="text-success size-4 shrink-0" />
            {plan.chat_per_hour} chat messages / hour burst
          </li>
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          variant={isCurrent ? "outline" : "default"}
          onClick={() => onSelect(plan)}
          disabled={busy || isCurrent || plan.monthly_price_usd === 0}
          className="w-full"
        >
          {isCurrent
            ? "Current plan"
            : plan.monthly_price_usd === 0
              ? "Downgrade via portal"
              : `Upgrade to ${plan.name}`}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function BillingClient({ initial }: { initial: PlanResponse }) {
  const [data] = useState<PlanResponse>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpgrade(plan: PlanLimits) {
    setError(null);
    setBusy(true);
    try {
      const res = await postJson<{ url: string }>("/api/billing/checkout", {
        plan: plan.name,
      });
      window.location.href = res.url;
    } catch (e) {
      setError(messageFromUnknown(e, "Couldn't start checkout."));
      setBusy(false);
    }
  }

  async function onPortal() {
    setError(null);
    setBusy(true);
    try {
      const res = await postJson<{ url: string }>("/api/billing/portal", {});
      window.location.href = res.url;
    } catch (e) {
      setError(messageFromUnknown(e, "Couldn't open the billing portal."));
      setBusy(false);
    }
  }

  const currentName = data.plan.name;
  const currentUsage = data.usage.datasets;
  const datasetPct = Math.min(
    100,
    Math.round((currentUsage / Math.max(1, data.plan.max_datasets)) * 100),
  );
  const chatTokensCap = data.plan.chat_tokens_per_month;
  const chatTokensUsed = data.usage.chat_tokens_used;
  const chatTokenPct = Math.min(
    100,
    Math.round((chatTokensUsed / Math.max(1, chatTokensCap)) * 100),
  );
  const tokensResetCopy = data.usage.chat_tokens_period_end
    ? new Date(data.usage.chat_tokens_period_end).toLocaleDateString()
    : null;

  return (
    <>
      <PageHeader
        title="Billing"
        description={
          <span>
            You&apos;re on the{" "}
            <span className="text-foreground font-semibold capitalize">
              {currentName}
            </span>{" "}
            plan. Status:{" "}
            <span className="font-mono text-xs">{data.status}</span>.
            {data.cancel_at_period_end ? (
              <span className="text-warning ml-1">
                Cancels at period end
                {data.current_period_end
                  ? ` (${new Date(data.current_period_end).toLocaleDateString()})`
                  : ""}
                .
              </span>
            ) : null}
          </span>
        }
        actions={
          <Button variant="outline" onClick={onPortal} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Manage in Stripe
            <ExternalLink className="size-4" />
          </Button>
        }
      />
      <div className="space-y-8 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>
              Datasets and chat tokens for this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span>Datasets</span>
                <span className="text-muted-foreground tabular-nums">
                  {currentUsage} / {data.plan.max_datasets}
                </span>
              </div>
              <Progress value={datasetPct} />
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span>Chat messages this period</span>
                <span className="text-muted-foreground tabular-nums">
                  {chatTokensUsed} / {chatTokensCap}
                </span>
              </div>
              <Progress value={chatTokenPct} />
              {tokensResetCopy ? (
                <p className="text-muted-foreground text-xs">
                  Resets {tokensResetCopy}.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            Plans
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {data.available_plans.map((p) => (
              <PlanCard
                key={p.name}
                plan={p}
                isCurrent={p.name === currentName}
                onSelect={onUpgrade}
                busy={busy}
              />
            ))}
          </div>
        </section>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}
