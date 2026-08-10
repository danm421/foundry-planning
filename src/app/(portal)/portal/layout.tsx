import type { ReactElement, ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import { resolveIntakeBrandingForClient } from "@/lib/branding/resolve-for-client";
import { loadPortalConnectionAlert } from "@/lib/portal/load-plaid-items";
import PortalNav from "@/components/portal/portal-nav";
import PortalMobileNav from "@/components/portal/portal-mobile-nav";
import PortalReadOnlyBanner from "@/components/portal/portal-read-only-banner";
import { PortalBrandingStrip } from "@/components/portal/portal-branding-mark";
import { PortalModeProvider } from "@/components/portal/portal-mode-context";
import { toPortalFeatures } from "@/lib/portal/features";
import { portalFeatureColumns } from "@/lib/portal/load-features";

export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();

  const [row] = await db
    .select({
      firmId: clients.firmId,
      advisorId: clients.advisorId,
      crmHouseholdId: clients.crmHouseholdId,
      portalEditEnabled: clients.portalEditEnabled,
      ...portalFeatureColumns,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  // crmHouseholdId is notNull in schema, but guard defensively per task spec.
  const householdId = row?.crmHouseholdId ?? null;

  let displayName = "";
  let email = "";

  if (householdId) {
    const [primary] = await db
      .select({
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
        email: crmHouseholdContacts.email,
      })
      .from(crmHouseholdContacts)
      .where(
        and(
          eq(crmHouseholdContacts.householdId, householdId),
          eq(crmHouseholdContacts.role, "primary"),
        ),
      )
      .limit(1);

    if (primary) {
      displayName = `${primary.firstName} ${primary.lastName}`.trim();
      email = primary.email ?? "";
    }
  }

  // Letterhead for the portal chrome, keyed by the client's advisor — an
  // advisor with branding enabled overlays their own logo/name/favicon over
  // the firm's; null → Foundry lockup (same fallback semantics as the intake
  // pages). Runs alongside the connection-alert read below — neither depends
  // on the other's result.
  const [branding, connectionAlert] = await Promise.all([
    row ? resolveIntakeBrandingForClient(row.firmId, row.advisorId) : Promise.resolve(null),
    // The dot is a decoration. There is no error.tsx under (portal), so an
    // unguarded rejection here would drop every portal page onto the root
    // global-error screen because a nav badge failed to resolve.
    loadPortalConnectionAlert(clientId).catch(() => false),
  ]);
  const navAlerts = { "/settings": connectionAlert };
  // Advisor-controlled section switches, read off the row above rather than in
  // a second query. A missing row can't happen behind
  // `requireClientPortalAccess`; `toPortalFeatures` defaults it to all-on
  // rather than presenting an empty portal.
  const features = toPortalFeatures(row);

  return (
    <div className="min-h-dvh bg-paper text-ink lg:grid lg:h-dvh lg:grid-cols-[240px_minmax(0,1fr)_auto] lg:overflow-hidden">
      {/* Desktop side rail — hidden on mobile, replaced by the top tab bar. */}
      {/*
        On desktop each of the three columns is pinned to the viewport height
        (`lg:h-dvh`) and scrolls independently (`lg:overflow-y-auto`), so
        scrolling one panel leaves the tops of the other two in view. Below `lg`
        the layout stacks and the page scrolls as one.
      */}
      <PortalNav
        displayName={displayName}
        email={email}
        className="hidden lg:flex lg:h-dvh lg:overflow-y-auto"
        alerts={navAlerts}
        features={features}
      />
      <main className="min-w-0 lg:h-dvh lg:overflow-y-auto lg:border-x lg:border-hair">
        {/* Mobile-only swipeable top tab bar. */}
        <PortalMobileNav
          displayName={displayName}
          branding={branding}
          className="lg:hidden"
          alerts={navAlerts}
          features={features}
        />
        {/* Desktop-only firm letterhead pinned above the scrolling content. */}
        <PortalBrandingStrip branding={branding} className="hidden lg:flex" />
        {!row?.portalEditEnabled && <PortalReadOnlyBanner />}
        <PortalModeProvider value={{ mode: "client", clientId }}>
          {children}
        </PortalModeProvider>
      </main>
      {/*
        Transaction detail target (createPortal). `empty:hidden` collapses the
        slot when nothing is selected — and with the `auto` third track, the
        empty grid column too — so the main content fills the full width. On
        desktop it's the 3rd grid column (a fixed 480px panel, `lg:p-4`); below
        `lg` the slot is a zero-height block and the portaled content positions
        itself as a bottom sheet (see transactions-list).
      */}
      <aside
        id="portal-detail"
        className="empty:hidden lg:h-dvh lg:w-[480px] lg:overflow-y-auto lg:p-4"
      />
    </div>
  );
}
