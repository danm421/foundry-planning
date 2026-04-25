import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ReactElement } from "react";
import BrandHeader from "./brand-header";
import SidebarNav from "./sidebar-nav";
import UserMenu from "./user-menu";
import ClientSearch from "./client-search";
import { PanelLeftIcon } from "./icons";

export async function toggleSidebar(): Promise<void> {
  "use server";
  const jar = await cookies();
  const current = jar.get("sidebar-collapsed")?.value !== "0";
  jar.set("sidebar-collapsed", current ? "0" : "1", { path: "/" });
  revalidatePath("/", "layout");
}

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
      <form action={toggleSidebar} className="border-b border-hair">
        <button
          type="submit"
          className={`flex w-full items-center ${collapsed ? "justify-center" : "justify-end"} px-[var(--pad-card)] py-3 text-ink-3 hover:text-ink hover:bg-card-hover`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeftIcon />
        </button>
      </form>
      {collapsed ? null : <ClientSearch />}
      <SidebarNav clientsCount={clientsCount} />
      <div className="mt-auto border-t border-hair">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
