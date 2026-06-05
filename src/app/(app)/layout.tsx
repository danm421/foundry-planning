import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { ReactElement } from "react";
import { BackNavProvider } from "@/components/back-nav-provider";
import Footer from "@/components/footer";
import Sidebar from "@/components/sidebar";
import SidebarFrame from "@/components/sidebar-frame";
import { SidebarProvider } from "@/components/sidebar-provider";
import Topbar from "@/components/topbar";
import { countCrmHouseholdsForFirm } from "@/lib/crm/households";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const [{ orgId }, jar] = await Promise.all([auth(), cookies()]);
  const collapsed = jar.get("sidebar-collapsed")?.value !== "0";
  const clientsCount = orgId ? await countCrmHouseholdsForFirm(orgId) : 0;

  return (
    <SidebarProvider initialCollapsed={collapsed}>
      <div
        className="grid min-h-screen"
        style={{ gridTemplateColumns: "64px 1fr" }}
      >
        <SidebarFrame>
          <Sidebar clientsCount={clientsCount} />
        </SidebarFrame>
        <BackNavProvider>
          <div className="col-start-2 flex min-h-screen min-w-0 flex-col">
            <Topbar />
            <main className="flex-1 bg-paper">{children}</main>
            <Footer />
          </div>
        </BackNavProvider>
      </div>
    </SidebarProvider>
  );
}
