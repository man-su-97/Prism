import { cookies } from "next/headers";

import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export async function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sidebarStateCookie = cookieStore.get("sidebar_state");
  const defaultOpen = sidebarStateCookie?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AdminSidebar user={user} />
      <SidebarInset>
        <header
          className={cn(
            "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 px-4",
            "bg-background/85 supports-backdrop-filter:bg-background/60 backdrop-blur-lg",
            "border-b border-border/60",
          )}
        >
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
          >
            Read-only · Admin
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <div className="relative flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
