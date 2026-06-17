"use client";

import type { ReactElement } from "react";
import BrandHeader from "./brand-header";
import SidebarNav from "./sidebar-nav";
import { useSidebar } from "./sidebar-provider";
import UserMenu from "./user-menu";
import ClientSearch from "./client-search";

interface SidebarProps {
  firmName?: string;
  clientsCount: number;
  isOpsAdmin: boolean;
}

export default function Sidebar({
  firmName,
  clientsCount,
  isOpsAdmin,
}: SidebarProps): ReactElement {
  const { collapsed } = useSidebar();
  return (
    <aside
      data-collapsed={collapsed || undefined}
      className="flex h-full w-full flex-col overflow-hidden border-r border-hair bg-card-2 shadow-lg"
    >
      <BrandHeader firmName={firmName} />
      {collapsed ? null : <ClientSearch />}
      <SidebarNav clientsCount={clientsCount} />
      <div className="mt-auto border-t border-hair">
        <UserMenu isOpsAdmin={isOpsAdmin} />
      </div>
    </aside>
  );
}
