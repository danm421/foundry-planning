import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import HouseholdSection from "@/components/portal/household-section";
import FamilySection from "@/components/portal/family-section";
import TrustsSection from "@/components/portal/trusts-section";
import AccountsSection from "@/components/portal/accounts-section";
import TransactionsSection from "@/components/portal/transactions-section";
import PortalNav from "@/components/portal/portal-nav";
import PortalPreviewBanner from "@/components/portal/portal-preview-banner";

interface Props {
  params: Promise<{ id: string; slug?: string[] }>;
}

export default async function PortalPreviewPage({
  params,
}: Props): Promise<ReactElement> {
  const { id, slug } = await params;

  // Firm-ownership of `id` is enforced by the parent clients/[id]/layout.tsx
  // (requireClientAccess → notFound() on wrong firm). The by-id db reads below
  // are safe ONLY because no ungated layout sits between that layout and this
  // page — do not add a portal/ or preview/ layout without re-asserting access.

  // Dispatch on slug. Empty / ["profile"] → Household.
  const path = (slug ?? []).join("/");
  let section: ReactElement;
  if (path === "" || path === "profile") {
    section = <HouseholdSection clientId={id} previewing />;
  } else if (path === "profile/family") {
    section = <FamilySection clientId={id} previewing />;
  } else if (path === "profile/trusts") {
    section = <TrustsSection clientId={id} previewing />;
  } else if (path === "accounts") {
    section = <AccountsSection clientId={id} previewing />;
  } else if (path === "transactions") {
    section = <TransactionsSection clientId={id} previewing />;
  } else {
    notFound();
  }

  // Pull display name + email + editEnabled for nav + banner.
  const [row] = await db
    .select({
      crmHouseholdId: clients.crmHouseholdId,
      portalEditEnabled: clients.portalEditEnabled,
    })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);

  const contacts = row?.crmHouseholdId
    ? await db
        .select({
          firstName: crmHouseholdContacts.firstName,
          lastName: crmHouseholdContacts.lastName,
          email: crmHouseholdContacts.email,
          role: crmHouseholdContacts.role,
        })
        .from(crmHouseholdContacts)
        .where(eq(crmHouseholdContacts.householdId, row.crmHouseholdId))
    : [];
  const primary = contacts.find((c) => c.role === "primary") ?? contacts[0];
  const displayName = primary
    ? `${primary.firstName} ${primary.lastName ?? ""}`.trim()
    : "";

  const basePath = `/clients/${id}/portal/preview`;

  return (
    <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[240px_minmax(0,1fr)_420px] border border-hair bg-paper text-ink">
      <PortalNav
        displayName={displayName}
        email={primary?.email ?? ""}
        basePath={basePath}
      />
      <main className="border-x border-hair">
        <PortalPreviewBanner
          clientId={id}
          clientName={displayName}
          editEnabled={row?.portalEditEnabled ?? false}
        />
        {section}
      </main>
      <aside id="portal-detail" className="p-4" />
    </div>
  );
}
