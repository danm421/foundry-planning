import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { ReactElement } from "react";
import AppShell from "@/components/app-shell";
import { BackNavProvider } from "@/components/back-nav-provider";
import Footer from "@/components/footer";
import ImpersonationBanner from "@/components/impersonation-banner";
import Sidebar from "@/components/sidebar";
import SidebarFrame from "@/components/sidebar-frame";
import { SidebarProvider } from "@/components/sidebar-provider";
import { SubscriptionGuard } from "@/components/subscription-guard";
import Topbar from "@/components/topbar";
import { countCrmHouseholdsForFirm } from "@/lib/crm/households";
import { getSubscriptionState } from "@/lib/billing/subscription-state";
import { getOpsAdmin } from "@/lib/ops/ops-auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const [{ orgId, sessionClaims, actor }, jar, state, opsAdmin] = await Promise.all([
    auth(),
    cookies(),
    getSubscriptionState(),
    getOpsAdmin(),
  ]);
  const isOpsAdmin = opsAdmin !== null;
  const collapsed = jar.get("sidebar-collapsed")?.value !== "0";
  const clientsCount = orgId ? await countCrmHouseholdsForFirm(orgId) : 0;
  const meta =
    (sessionClaims as { org_public_metadata?: { is_founder?: boolean } } | null)
      ?.org_public_metadata ?? {};
  const isFounder = meta.is_founder === true;

  let impersonatedName: string | null = null;
  if (actor?.sub) {
    const u = await currentUser();
    impersonatedName =
      [u?.firstName, u?.lastName].filter(Boolean).join(" ") ||
      u?.emailAddresses?.[0]?.emailAddress ||
      "this advisor";
  }

  return (
    <SidebarProvider initialCollapsed={collapsed}>
      <AppShell>
        <SidebarFrame>
          <Sidebar clientsCount={clientsCount} isOpsAdmin={isOpsAdmin} />
        </SidebarFrame>
        <BackNavProvider>
          <div className="col-start-2 flex min-h-screen min-w-0 flex-col">
            {impersonatedName && <ImpersonationBanner advisorName={impersonatedName} />}
            <Topbar />
            <div className="px-[var(--pad-card)] pt-[var(--pad-card)] empty:hidden">
              <SubscriptionGuard state={state} isFounder={isFounder} />
            </div>
            <main className="flex min-h-0 flex-1 flex-col bg-paper">{children}</main>
            <Footer />
          </div>
        </BackNavProvider>
      </AppShell>
    </SidebarProvider>
  );
}
