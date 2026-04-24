import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { ReactElement } from "react";
import Sidebar from "@/components/sidebar";
import Topbar from "@/components/topbar";
import { countClientsForFirm } from "@/lib/client-search";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const [{ orgId }, jar] = await Promise.all([auth(), cookies()]);
  const collapsed = jar.get("sidebar-collapsed")?.value === "1";
  const clientsCount = orgId ? await countClientsForFirm(orgId) : 0;

  return (
    <div
      className="grid min-h-screen"
      style={{
        gridTemplateColumns: collapsed ? "64px 1fr" : "240px 1fr",
        transition: "grid-template-columns 0.22s ease",
      }}
    >
      <Sidebar collapsed={collapsed} clientsCount={clientsCount} />
      <div className="flex min-h-screen flex-col">
        <Topbar />
        <main className="flex-1 bg-paper">
          {children}
          <footer className="mt-8 border-t border-hair px-[var(--pad-card)] py-4 text-[12px] text-ink-4">
            © Foundry Planning ·{" "}
            <a href="#" className="hover:text-ink-3">Privacy</a> ·{" "}
            <a href="#" className="hover:text-ink-3">Terms</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
