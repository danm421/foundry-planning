import type { ReactElement } from "react";
import BrandHeader from "./brand-header";
import SidebarNav from "./sidebar-nav";
import SidebarToggle from "./sidebar-toggle";
import UserMenu from "./user-menu";
import ClientSearch from "./client-search";

interface SidebarProps {
  collapsed: boolean;
  firmName?: string;
  clientsCount: number;
}

export default function Sidebar({
  collapsed,
  firmName,
  clientsCount,
}: SidebarProps): ReactElement {
  return (
    <aside
      data-collapsed={collapsed || undefined}
      className="flex flex-col border-r border-hair bg-card-2"
    >
      <BrandHeader firmName={firmName} collapsed={collapsed} />
      <SidebarToggle collapsed={collapsed} />
      {collapsed ? null : <ClientSearch />}
      <SidebarNav clientsCount={clientsCount} collapsed={collapsed} />
      <div className="mt-auto border-t border-hair">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
