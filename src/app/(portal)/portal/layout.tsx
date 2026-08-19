import type { ReactElement, ReactNode } from "react";
import { and, eq, inArray } from "drizzle-orm";
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
import { portalGreetingName } from "@/lib/portal/greeting-name";
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

  // Both halves of the household — the welcome line names the spouse too.
  // Roles are unique per household (one primary, one spouse), so this is at
  // most two rows. Email stays the primary's: it identifies the signed-in
  // account, not the household.
  const contacts = householdId
    ? await db
        .select({
          role: crmHouseholdContacts.role,
          firstName: crmHouseholdContacts.firstName,
          preferredName: crmHouseholdContacts.preferredName,
          email: crmHouseholdContacts.email,
        })
        .from(crmHouseholdContacts)
        .where(
          and(
            eq(crmHouseholdContacts.householdId, householdId),
            inArray(crmHouseholdContacts.role, ["primary", "spouse"]),
          ),
        )
    : [];

  const displayName = portalGreetingName(contacts);
  const email = contacts.find((c) => c.role === "primary")?.email ?? "";

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
    <div className="min-h-dvh bg-paper text-ink lg:relative lg:grid lg:h-dvh lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-hidden">
      {/* Desktop side rail — hidden on mobile, replaced by the top tab bar. */}
      {/*
        On desktop the nav and the main column are each pinned to the viewport
        height (`lg:h-dvh`) and scroll independently (`lg:overflow-y-auto`), so
        scrolling one panel leaves the top of the other in view. Below `lg` the
        layout stacks and the page scrolls as one.
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
        Detail target (createPortal). On desktop it's an overlay drawer, not a
        third grid column: `lg:absolute` takes it out of the grid so opening a
        drill-down slides the 480px panel OVER the right of the page instead of
        squeezing the tiles underneath into a narrower column. `empty:hidden`
        keeps it out of the way when nothing is selected. Below `lg` the slot
        stays a zero-height block in flow and the portaled content positions
        itself as a bottom sheet (see portal-detail-rail).
      */}
      <aside
        id="portal-detail"
        className="portal-drawer empty:hidden lg:absolute lg:inset-y-0 lg:right-0 lg:z-30 lg:w-[480px] lg:overflow-y-auto lg:border-l lg:border-hair lg:bg-paper lg:p-4 lg:shadow-xl"
      />
    </div>
  );
}
