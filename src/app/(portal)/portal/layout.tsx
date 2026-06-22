import type { ReactElement, ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireClientPortalAccess } from "@/lib/authz";
import PortalNav from "@/components/portal/portal-nav";
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
    <div className="grid grid-cols-[240px_minmax(0,1fr)_420px] min-h-screen bg-paper text-ink">
      <PortalNav displayName={displayName} email={email} />
      <main className="border-x border-hair">
        {!row?.portalEditEnabled && <PortalReadOnlyBanner />}
        <PortalModeProvider value={{ mode: "client", clientId }}>
          {children}
        </PortalModeProvider>
      </main>
      <aside id="portal-detail" className="p-4" />
    </div>
  );
}
