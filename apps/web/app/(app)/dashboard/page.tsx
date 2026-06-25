import { redirect } from "next/navigation";

// Legacy intermediate route. The signed-in home now lives at /home — this
// keeps old bookmarks / deep links from breaking.
export const dynamic = "force-dynamic";

export default function LegacyDashboardRedirect() {
  redirect("/home");
}
