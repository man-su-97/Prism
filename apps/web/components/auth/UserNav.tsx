"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, CreditCard, LogOut, Settings, UserRound } from "lucide-react";

import { signOut } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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

export function UserNav({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();

  async function onSignOut() {
    await signOut();
    router.replace("/login");
    router.refresh();
  }

  const initials = name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div
                className={
                  "flex aspect-square size-8 items-center justify-center rounded-full text-xs font-semibold text-white " +
                  "bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) " +
                  "shadow-[0_2px_8px_-2px_oklch(from_var(--primary)_l_c_h/0.30)]"
                }
              >
                {initials || <UserRound className="size-4" />}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            sideOffset={4}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground text-xs">{email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => router.push("/settings/workspace")}
                className="gap-2"
              >
                <Settings className="size-4" />
                Workspace settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push("/settings/billing")}
                className="gap-2"
              >
                <CreditCard className="size-4" />
                Billing
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut} className="gap-2">
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
