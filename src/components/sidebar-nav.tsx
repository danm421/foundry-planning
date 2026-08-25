"use client";

import { usePathname } from "next/navigation";
import { type MouseEvent, type ReactElement, type ReactNode } from "react";
import SidebarNavItem from "./sidebar-nav-item";
import { useSidebar } from "./sidebar-provider";
import {
  BellIcon,
  ClientsIcon,
  DataCollectionIcon,
  FolderIcon,
  HomeIcon,
  ListCheckIcon,
  RiskIcon,
  SettingsIcon,
} from "./icons";

interface NavItemSpec {
  icon: ReactNode;
  label: string;
  href?: string;
  placeholder?: boolean;
}

interface NavGroup {
  /** React key only. Groups are separated by a rule rather than a heading, so
   *  the icons sit at the same height whether the sidebar is open or collapsed
   *  — a heading that only exists when open pushed everything below it down. */
  key: string;
  items: NavItemSpec[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: "workspace",
    items: [
      { icon: <HomeIcon />, label: "Home", href: "/home" },
      { icon: <ClientsIcon />, label: "Clients", href: "/clients" },
      { icon: <RiskIcon />, label: "Risk", href: "/risk" },
      { icon: <FolderIcon />, label: "Models", href: "/cma" },
      { icon: <ListCheckIcon />, label: "Tasks", href: "/tasks" },
      { icon: <DataCollectionIcon />, label: "Data Collection", href: "/data-collection" },
    ],
  },
  {
    key: "firm",
    items: [
      { icon: <BellIcon />, label: "Alerts", href: "/alerts" },
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
  unreadCount: number;
}

export default function SidebarNav({
  clientsCount,
  unreadCount,
}: SidebarNavProps): ReactElement {
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useSidebar();

  // When the user picks a nav item while the sidebar is expanded, collapse
  // it so the destination page gets the wider canvas. No-op when already
  // collapsed, or when the user is opening the link in a new tab/window
  // (cmd/ctrl/shift/middle-click) — in that case the current view isn't
  // navigating, so collapsing would be a surprise. The collapsed state lives
  // in client context held by the preserved layout, so it stays collapsed
  // through the navigation instead of racing a server re-read.
  function handleNavigate(e: MouseEvent<HTMLAnchorElement>) {
    if (collapsed) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    setCollapsed(true);
  }

  return (
    <nav className="flex flex-col gap-4 py-4">
      {NAV_GROUPS.map((group, groupIndex) => (
        <div key={group.key} className="flex flex-col">
          {/* Same separator in both states, and none above the first group —
              the brand header's own rule already closes off the top. */}
          {groupIndex > 0 ? (
            <div aria-hidden className="mx-3 mb-2 border-t border-hair" />
          ) : null}
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
                    count={
                      item.href === "/clients"
                        ? clientsCount
                        : item.href === "/alerts" && unreadCount > 0
                          ? unreadCount
                          : undefined
                    }
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
