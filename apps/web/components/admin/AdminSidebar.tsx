"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  Building2,
  LayoutDashboard,
  ShieldAlert,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import { UserNav } from "@/components/auth/UserNav";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type NavItem = { label: string; href: string; icon: LucideIcon };

const navMain: readonly NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Workspaces", href: "/admin/workspaces", icon: Building2 },
  { label: "System", href: "/admin/system", icon: Activity },
];

export function AdminSidebar({
  user,
}: {
  user: { name: string; email: string };
}) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/admin" className="group/brand">
                <span
                  className={cn(
                    "relative flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg",
                    "bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to)",
                    "text-white shadow-[0_4px_12px_-2px_oklch(from_var(--primary)_l_c_h/0.35)]",
                    "transition-transform duration-300 group-hover/brand:scale-[1.04]",
                  )}
                >
                  <ShieldAlert className="size-4 drop-shadow" />
                </span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="flex items-center gap-1.5 truncate font-semibold tracking-tight">
                    Prism
                    <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-bold tracking-wider">
                      ADMIN
                    </Badge>
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    Internal portal
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navMain.map((item) => {
                const active = isActive(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "relative overflow-visible transition-colors",
                        "hover:bg-sidebar-accent/60",
                        active && "bg-transparent data-[active=true]:bg-transparent",
                      )}
                    >
                      <Link href={item.href}>
                        {active && (
                          <motion.span
                            layoutId="admin-sidebar-active-pill"
                            className={cn(
                              "absolute inset-0 -z-10 rounded-md",
                              "bg-sidebar-accent ring-1 ring-inset ring-sidebar-primary/25",
                            )}
                            transition={{
                              type: "spring",
                              stiffness: 380,
                              damping: 32,
                            }}
                          />
                        )}
                        <item.icon
                          className={cn(
                            "transition-colors",
                            active
                              ? "text-sidebar-primary"
                              : "text-muted-foreground group-hover/menu-button:text-foreground",
                          )}
                        />
                        <span
                          className={cn(
                            "transition-colors",
                            active
                              ? "text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/85",
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Back to app</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Return to user app">
                  <Link href="/home">
                    <Sparkles className="text-muted-foreground" />
                    <span className="text-sidebar-foreground/85">User app</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserNav name={user.name} email={user.email} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
