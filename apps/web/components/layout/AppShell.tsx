import { cookies } from "next/headers";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UpgradePlanButton } from "@/components/layout/UpgradePlanButton";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Workspace = { id: string; name: string; slug: string };

export async function AppShell({
  user,
  activeWorkspaceId,
  workspaces,
  children,
}: {
  user: { name: string; email: string };
  activeWorkspaceId: string | null | undefined;
  workspaces: Workspace[];
  children: React.ReactNode;
}) {
  // Restore the sidebar collapsed/expanded state from the cookie shadcn sets.
  const cookieStore = await cookies();
  const sidebarStateCookie = cookieStore.get("sidebar_state");
  const defaultOpen = sidebarStateCookie?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        user={user}
        activeWorkspaceId={activeWorkspaceId}
        workspaces={workspaces}
      />
      <SidebarInset>
        <header
          className={cn(
            "sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 px-4",
            "bg-background/85 supports-backdrop-filter:bg-background/60 backdrop-blur-lg",
            "border-b border-border/60",
          )}
        >
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <GlobalSearch />
          <div className="flex-1 sm:hidden" />
          <div className="ml-auto flex items-center gap-2">
            <UpgradePlanButton />
            <ThemeToggle />
          </div>
        </header>
        <div className="relative flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
