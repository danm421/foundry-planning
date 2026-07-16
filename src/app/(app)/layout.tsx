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
import { GlobalForgeMount } from "@/components/forge/global-forge-mount";
import { WalkthroughProvider } from "@/components/forge/walkthrough-provider";
import { isForgeEnabled } from "@/domain/forge/flag";

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
    <WalkthroughProvider>
      <SidebarProvider initialCollapsed={collapsed}>
        <AppShell>
          <SidebarFrame>
            <Sidebar clientsCount={clientsCount} isOpsAdmin={isOpsAdmin} />
          </SidebarFrame>
          <BackNavProvider>
            {/* A route opts into an app-like, viewport-filling surface (the
                solver) by marking its root [data-fills-viewport]. min-h-screen
                alone is height:auto, so a flex child's min-h-0 has nothing to
                shrink against and the chain grows to fit content — the window
                scrolls instead of the surface's own panes (see 2b523c7cd). A
                definite height makes that chain resolve, and the trailing
                footer margin goes with it so the surface sits flush against the
                footer. min-h-0 is required alongside: min-h-screen is 100vh and
                would out-vote height:100dvh wherever browser chrome collapses.
                lg-only: below that the panes stack and the page scrolls. */}
            <div className="col-start-2 flex min-h-screen min-w-0 flex-col has-[[data-fills-viewport]]:lg:h-dvh has-[[data-fills-viewport]]:lg:min-h-0 has-[[data-fills-viewport]]:lg:[&>footer]:mt-0">
              {impersonatedName && <ImpersonationBanner advisorName={impersonatedName} />}
              <Topbar />
              <div className="px-[var(--pad-card)] pt-[var(--pad-card)] empty:hidden">
                <SubscriptionGuard state={state} isFounder={isFounder} />
              </div>
              <main className="flex min-h-0 flex-1 flex-col bg-paper">{children}</main>
              <Footer />
              <GlobalForgeMount enabled={isForgeEnabled()} />
            </div>
          </BackNavProvider>
        </AppShell>
      </SidebarProvider>
    </WalkthroughProvider>
  );
}
