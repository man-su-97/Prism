import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { AppShell } from "@/components/layout/AppShell";
import { UpgradePromptProvider } from "@/components/upgrade/UpgradePromptProvider";
import { auth } from "@/lib/auth";
import { backendJson } from "@/lib/backend";
import type { PlanResponse } from "@/lib/billing";
import { getSession, resolveActiveOrgId } from "@/lib/session";

// Every page under (app)/ depends on the request's session cookie. Static
// prerendering would call auth.api.getSession at build time, which crashes
// without a real Postgres + secret. Force dynamic so Next.js renders per request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const activeWorkspaceId = await resolveActiveOrgId(session);
  if (!activeWorkspaceId) redirect("/onboarding/workspace");

  const workspaces = await auth.api.listOrganizations({
    headers: await headers(),
  });

  // Plan info drives the top-right "Upgrade plan" button and the limit-hit
  // popup. Tolerate failures: header button just hides, popup falls back to
  // a "Open Billing" CTA.
  let initialPlan: PlanResponse | null = null;
  try {
    initialPlan = await backendJson<PlanResponse>("/api/billing/plan");
  } catch {
    /* leave null */
  }

  return (
    <UpgradePromptProvider initialPlan={initialPlan}>
      <AppShell
        user={{
          name: session.user.name ?? session.user.email,
          email: session.user.email,
        }}
        activeWorkspaceId={activeWorkspaceId}
        workspaces={workspaces ?? []}
      >
        {children}
      </AppShell>
    </UpgradePromptProvider>
  );
}
