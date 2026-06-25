import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

// Better Auth doesn't repopulate session.activeOrganizationId on a fresh login,
// so a returning user with existing orgs would otherwise be bounced to the
// onboarding form on every sign-in. Auto-pick the first org instead, and only
// redirect when the user genuinely has none.
export async function resolveActiveOrgId(
  session: Awaited<ReturnType<typeof requireSession>>,
): Promise<string | null> {
  if (session.session.activeOrganizationId) {
    return session.session.activeOrganizationId;
  }
  const h = await headers();
  const orgs = await auth.api.listOrganizations({ headers: h });
  const first = orgs?.[0];
  if (!first) return null;
  await auth.api.setActiveOrganization({
    headers: h,
    body: { organizationId: first.id },
  });
  return first.id;
}

export async function requireActiveOrg() {
  const session = await requireSession();
  const orgId = await resolveActiveOrgId(session);
  if (!orgId) {
    redirect("/onboarding/workspace");
  }
  session.session.activeOrganizationId = orgId;
  return session;
}
