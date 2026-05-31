"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition, type MouseEvent, type ReactElement, type ReactNode } from "react";
import SidebarNavItem from "./sidebar-nav-item";
import {
  HomeIcon,
  ClientsIcon,
  FolderIcon,
  FileTextIcon,
  ListCheckIcon,
  BarChartIcon,
  SettingsIcon,
} from "./icons";

interface NavItemSpec {
  icon: ReactNode;
  label: string;
  href?: string;
  placeholder?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItemSpec[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "WORKSPACE",
    items: [
      { icon: <HomeIcon />, label: "Home", placeholder: true },
      { icon: <ClientsIcon />, label: "Clients", href: "/clients" },
      { icon: <FolderIcon />, label: "CMA's", href: "/cma" },
      { icon: <FileTextIcon />, label: "Presentations", placeholder: true },
      { icon: <ListCheckIcon />, label: "Tasks", href: "/tasks" },
    ],
  },
  {
    label: "FIRM",
    items: [
      { icon: <BarChartIcon />, label: "Reports", placeholder: true },
      { icon: <FolderIcon />, label: "Documents", placeholder: true },
      { icon: <SettingsIcon />, label: "Settings", href: "/settings" },
    ],
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

interface SidebarNavProps {
  clientsCount: number;
  collapsed?: boolean;
}

export default function SidebarNav({
  clientsCount,
  collapsed = false,
}: SidebarNavProps): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  // When the user picks a nav item while the sidebar is expanded, collapse
  // it so the destination page gets the wider canvas. No-op when already
  // collapsed, or when the user is opening the link in a new tab/window
  // (cmd/ctrl/shift/middle-click) — in that case the current view isn't
  // navigating, so collapsing would be a surprise. We set the same cookie
  // BrandMarkToggle owns + refresh so the server layout re-reads it.
  function handleNavigate(e: MouseEvent<HTMLAnchorElement>) {
    if (collapsed) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    document.cookie = `sidebar-collapsed=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <nav className="flex flex-col gap-4 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col">
          {collapsed ? (
            <div aria-hidden className="mx-3 mb-2 border-t border-hair" />
          ) : (
            <div className="px-[var(--pad-card)] pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">
              {group.label}
            </div>
          )}
          <ul className="flex flex-col">
            {group.items.map((item) => {
              const active = !item.placeholder && item.href
                ? isActivePath(pathname, item.href)
                : false;
              return (
                <li key={item.label}>
                  <SidebarNavItem
                    icon={item.icon}
                    label={item.label}
                    href={item.href}
                    placeholder={item.placeholder}
                    active={active}
                    count={item.href === "/clients" ? clientsCount : undefined}
                    collapsed={collapsed}
                    onNavigate={handleNavigate}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
