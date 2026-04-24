import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ReactElement } from "react";
import BrandHeader from "./brand-header";
import SidebarNav from "./sidebar-nav";
import UserMenu from "./user-menu";
import ClientSearch from "./client-search";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

export async function toggleSidebar(): Promise<void> {
  "use server";
  const jar = await cookies();
  const current = jar.get("sidebar-collapsed")?.value === "1";
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
      {collapsed ? null : <ClientSearch />}
      <SidebarNav clientsCount={clientsCount} />
      <div className="mt-auto border-t border-hair">
        <UserMenu collapsed={collapsed} />
        <form action={toggleSidebar} className="border-t border-hair">
          <button
            type="submit"
            className="flex w-full items-center justify-center px-[var(--pad-card)] py-2 text-ink-4 hover:text-ink hover:bg-card-hover"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>
        </form>
      </div>
    </aside>
  );
}
