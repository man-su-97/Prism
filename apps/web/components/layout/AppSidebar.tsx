"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  CreditCard,
  Database,
  Home,
  LayoutDashboard,
  Link2,
  Settings,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";

import { LogoMark, LogoFull } from "@/components/layout/Logo";

import { UserNav } from "@/components/auth/UserNav";
import { WorkspaceSwitcher } from "@/components/auth/WorkspaceSwitcher";
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
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Workspace = { id: string; name: string; slug: string };
type NavItem = { label: string; href: string; icon: LucideIcon };

const navMain: readonly NavItem[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Dashboards", href: "/dashboards", icon: LayoutDashboard },
  { label: "Datasets", href: "/datasets", icon: Database },
];

// The /admin super-admin portal is intentionally absent from this sidebar.
// Operators reach it by direct URL only — the portal must not advertise
// itself to non-admin users. See apps/web/app/(admin)/layout.tsx.

const navAccount: readonly NavItem[] = [
  { label: "Profile", href: "/settings/profile", icon: User },
  { label: "Security", href: "/settings/security", icon: ShieldCheck },
  { label: "Connected", href: "/settings/connected", icon: Link2 },
];

const navWorkspaceAdmin: readonly NavItem[] = [
  { label: "Workspace", href: "/settings/workspace", icon: Settings },
  { label: "Billing", href: "/settings/billing", icon: CreditCard },
];

export function AppSidebar({
  user,
  activeWorkspaceId,
  workspaces,
}: {
  user: { name: string; email: string };
  activeWorkspaceId: string | null | undefined;
  workspaces: Workspace[];
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-0 pb-0">
        {/* Brand logo — CSS-driven swap between full wordmark and icon mark */}
        <Link
          href="/home"
          aria-label="Prism home"
          className={cn(
            "flex h-12 items-center px-2 transition-opacity hover:opacity-80",
            "group-data-[state=collapsed]:h-10 group-data-[state=collapsed]:justify-center group-data-[state=collapsed]:px-0 group-data-[state=collapsed]:py-1",
          )}
        >
          {/* Full wordmark — hidden in collapsed mode */}
          <LogoFull className="group-data-[state=collapsed]:hidden" />
          {/* Icon mark — shown only in collapsed mode */}
          <LogoMark size={26} className="hidden group-data-[state=collapsed]:block" />
        </Link>
        <SidebarSeparator className="mx-0 my-1" />
        <WorkspaceSwitcher
          activeWorkspaceId={activeWorkspaceId}
          workspaces={workspaces}
        />
        <SidebarSeparator className="mx-0 mt-1 mb-0" />
      </SidebarHeader>
      <SidebarContent className="pt-3">
        <NavGroup label="Workspace" items={navMain} isActive={isActive} />
        <NavGroup label="Account" items={navAccount} isActive={isActive} />
        <NavGroup
          label="Workspace settings"
          items={navWorkspaceAdmin}
          isActive={isActive}
        />
      </SidebarContent>
      <SidebarFooter>
        <UserNav name={user.name} email={user.email} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavGroup({
  label,
  items,
  isActive,
}: {
  label: string;
  items: readonly NavItem[];
  isActive: (href: string) => boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
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
                  <Link href={item.href} onClick={closeMobile}>
                    {active && (
                      <motion.span
                        layoutId="sidebar-active-pill"
                        className={cn(
                          "absolute inset-0 -z-10 rounded-sm",
                          "bg-(--color-lime-fill) border-l-[3px] border-l-(--color-lime)",
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
                          ? "text-(--color-lime)"
                          : "text-muted-foreground group-hover/menu-button:text-foreground",
                      )}
                    />
                    <span
                      className={cn(
                        "transition-colors",
                        active
                          ? "text-(--color-lime) font-medium"
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
  );
}
