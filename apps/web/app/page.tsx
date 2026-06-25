import { redirect } from "next/navigation";

import { getSession, resolveActiveOrgId } from "@/lib/session";

// Depends on the request cookie — don't prerender.
export const dynamic = "force-dynamic";

export default async function RootRedirect() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const orgId = await resolveActiveOrgId(session);
  if (!orgId) redirect("/onboarding/workspace");
  redirect("/home");
}
