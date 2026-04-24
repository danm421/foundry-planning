"use client";

import { usePathname } from "next/navigation";
import type { ReactElement, ReactNode } from "react";
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
      { icon: <ListCheckIcon />, label: "Tasks", placeholder: true },
    ],
  },
  {
    label: "FIRM",
    items: [
      { icon: <BarChartIcon />, label: "Reports", placeholder: true },
      { icon: <FolderIcon />, label: "Documents", placeholder: true },
      { icon: <SettingsIcon />, label: "Settings", placeholder: true },
    ],
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

interface SidebarNavProps {
  clientsCount: number;
}

export default function SidebarNav({ clientsCount }: SidebarNavProps): ReactElement {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col">
          <div className="px-[var(--pad-card)] pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">
            {group.label}
          </div>
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
