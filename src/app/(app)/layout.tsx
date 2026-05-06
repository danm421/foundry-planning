import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { ReactElement } from "react";
import Footer from "@/components/footer";
import Sidebar from "@/components/sidebar";
import Topbar from "@/components/topbar";
import { countClientsForFirm } from "@/lib/client-search";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const [{ orgId }, jar] = await Promise.all([auth(), cookies()]);
  const collapsed = jar.get("sidebar-collapsed")?.value !== "0";
  const clientsCount = orgId ? await countClientsForFirm(orgId) : 0;

  return (
    <div
      className="grid min-h-screen"
      style={{ gridTemplateColumns: "64px 1fr" }}
    >
      <div
        className="fixed left-0 top-0 z-30 h-screen"
        style={{
          width: collapsed ? 64 : 240,
          transition: "width 0.22s ease",
        }}
      >
        <Sidebar collapsed={collapsed} clientsCount={clientsCount} />
      </div>
      <div className="col-start-2 flex min-h-screen flex-col">
        <Topbar />
        <main className="flex-1 bg-paper">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
