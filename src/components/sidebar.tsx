"use client";

import type { ReactElement } from "react";
import BrandHeader from "./brand-header";
import SidebarNav from "./sidebar-nav";
import { useSidebar } from "./sidebar-provider";
import UserMenu from "./user-menu";

interface SidebarProps {
  firmName?: string;
  clientsCount: number;
  unreadCount: number;
  isOpsAdmin: boolean;
}

export default function Sidebar({
  firmName,
  clientsCount,
  unreadCount,
  isOpsAdmin,
}: SidebarProps): ReactElement {
  const { collapsed } = useSidebar();
  return (
    <aside
      data-collapsed={collapsed || undefined}
      className="flex h-full w-full flex-col overflow-hidden border-r border-hair bg-card-2 shadow-lg"
    >
      <BrandHeader firmName={firmName} />
      <SidebarNav clientsCount={clientsCount} unreadCount={unreadCount} />
      <div className="mt-auto border-t border-hair">
        <UserMenu isOpsAdmin={isOpsAdmin} />
      </div>
    </aside>
  );
}
