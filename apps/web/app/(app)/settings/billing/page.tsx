import { BillingClient } from "./BillingClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { backendJson } from "@/lib/backend";
import type { PlanResponse } from "@/lib/billing";
import { messageFromUnknown } from "@/lib/errors";

export default async function BillingPage() {
  let initial: PlanResponse | null = null;
  let error: string | null = null;
  try {
    initial = await backendJson<PlanResponse>("/api/billing/plan");
  } catch (e) {
    error = messageFromUnknown(e, "Couldn't load your plan info.");
  }

  if (!initial) {
    return (
      <>
        <PageHeader title="Billing" />
        <div className="p-4 sm:p-6">
          <p className="text-destructive text-sm" role="alert">
            {error ?? "Billing unavailable."}
          </p>
        </div>
      </>
    );
  }

  return <BillingClient initial={initial} />;
}
