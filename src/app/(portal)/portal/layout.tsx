import type { ReactElement, ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import PortalNav from "@/components/portal/portal-nav";
import PortalMobileNav from "@/components/portal/portal-mobile-nav";
import PortalReadOnlyBanner from "@/components/portal/portal-read-only-banner";
import { PortalModeProvider } from "@/components/portal/portal-mode-context";

export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();

  const [row] = await db
    .select({
      crmHouseholdId: clients.crmHouseholdId,
      portalEditEnabled: clients.portalEditEnabled,
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

  return (
    <div className="min-h-dvh bg-paper text-ink lg:grid lg:grid-cols-[240px_minmax(0,1fr)_auto]">
      {/* Desktop side rail — hidden on mobile, replaced by the top tab bar. */}
      <PortalNav
        displayName={displayName}
        email={email}
        className="hidden lg:flex"
      />
      <main className="min-w-0 lg:border-x lg:border-hair">
        {/* Mobile-only swipeable top tab bar. */}
        <PortalMobileNav displayName={displayName} className="lg:hidden" />
        {!row?.portalEditEnabled && <PortalReadOnlyBanner />}
        <PortalModeProvider value={{ mode: "client", clientId }}>
          {children}
        </PortalModeProvider>
      </main>
      {/*
        Transaction detail target (createPortal). `empty:hidden` collapses the
        slot when nothing is selected — and with the `auto` third track, the
        empty grid column too — so the main content fills the full width. On
        desktop it's the 3rd grid column (a fixed 420px panel, `lg:p-4`); below
        `lg` the slot is a zero-height block and the portaled content positions
        itself as a bottom sheet (see transactions-list).
      */}
      <aside id="portal-detail" className="empty:hidden lg:w-[420px] lg:p-4" />
    </div>
  );
}
