"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown, Plus, Layers } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type Workspace = { id: string; name: string; slug: string };

export function WorkspaceSwitcher({
  activeWorkspaceId,
  workspaces,
}: {
  activeWorkspaceId: string | null | undefined;
  workspaces: Workspace[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const active =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null;

  function switchTo(id: string) {
    if (id === activeWorkspaceId) return;
    start(async () => {
      await authClient.organization.setActive({ organizationId: id });
      // Workspace-scoped URLs like /dashboards/{id} or /datasets/{id} resolve
      // to records that don't exist in the newly-selected workspace, so a
      // bare router.refresh() would land users on a 404. Send them to /home
      // and force a server re-fetch so the sidebar + page reflect the new
      // workspace's data immediately.
      router.replace("/home");
      router.refresh();
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              disabled={pending}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div
                className={
                  "flex aspect-square size-8 items-center justify-center rounded-lg " +
                  "bg-linear-to-br from-sidebar-primary to-[var(--brand-via)] text-sidebar-primary-foreground " +
                  "shadow-[0_2px_8px_-2px_oklch(from_var(--primary)_l_c_h/0.25)]"
                }
              >
                <Layers className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {active?.name ?? "Select workspace"}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {active?.slug ?? "—"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={4}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => switchTo(w.id)}
                className="gap-2"
              >
                <Layers className="size-4 opacity-70" />
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === activeWorkspaceId ? (
                  <Check className="size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push("/onboarding/workspace")}
              className="gap-2 text-muted-foreground"
            >
              <Plus className="size-4" />
              New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
