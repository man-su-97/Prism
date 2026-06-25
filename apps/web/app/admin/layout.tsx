import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { isSuperAdmin } from "@/lib/admin";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin · Prism",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // notFound() instead of redirect("/login") or 403 — the portal must not
  // reveal itself to non-admin callers, signed in or out.
  if (!session?.user) notFound();
  if (!isSuperAdmin(session.user.email)) notFound();

  return (
    <AdminShell
      user={{
        name: session.user.name ?? session.user.email,
        email: session.user.email,
      }}
    >
      {children}
    </AdminShell>
  );
}
