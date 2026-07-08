import type { ReactElement } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { requireClientAccess } from "@/lib/clients/authz";
import HouseholdSection from "@/components/portal/household-section";
import FamilySection from "@/components/portal/family-section";
import TrustsSection from "@/components/portal/trusts-section";
import { PortalAccountsScreen } from "@/components/portal/portal-accounts-screen";
import TransactionsSection from "@/components/portal/transactions-section";
import BudgetSection from "@/components/portal/budget-section";
import RecurringsSection from "@/components/portal/recurrings-section";
import { PortalInvestmentsScreen } from "@/components/portal/portal-investments-screen";
import PortalDashboard from "@/components/portal/portal-dashboard";
import PortalNav from "@/components/portal/portal-nav";
import PortalPreviewBanner from "@/components/portal/portal-preview-banner";
import { PortalModeProvider } from "@/components/portal/portal-mode-context";
import { NotSharedNotice } from "@/components/portal/not-shared-notice";
import { PortalSettingsView } from "@/components/portal/portal-settings-view";
import { loadPortalPrivacy } from "@/lib/portal/privacy";

interface Props {
  params: Promise<{ id: string; slug?: string[] }>;
}

// Advisor-only preview of the client portal. This route lives OUTSIDE the
// (app) route group so it renders full-screen — no advisor sidebar/topbar —
// matching what the client actually sees. It's opened in a new tab from
// /clients/[id]/portal.
export const metadata: Metadata = {
  title: "Portal preview",
  robots: { index: false, follow: false },
};

export default async function PortalPreviewPage({
  params,
}: Props): Promise<ReactElement> {
  const { id, slug } = await params;

  // No parent layout asserts firm-ownership here (unlike routes under
  // (app)/clients/[id]) — this page must do it itself before any by-id reads.
  const access = await requireClientAccess(id).catch(() => null);
  if (!access) notFound();

  // The client's advisor-sharing switches gate the budgeting sections below.
  // Gated sections render a NotSharedNotice INSTEAD of loading data — nothing
  // the client kept private may enter this page's payload. Both reads sit
  // behind the access gate above; they are independent of each other.
  const [privacy, contacts] = await Promise.all([
    loadPortalPrivacy(id),
    access.client.crmHouseholdId
      ? db
          .select({
            firstName: crmHouseholdContacts.firstName,
            lastName: crmHouseholdContacts.lastName,
            email: crmHouseholdContacts.email,
            role: crmHouseholdContacts.role,
          })
          .from(crmHouseholdContacts)
          .where(eq(crmHouseholdContacts.householdId, access.client.crmHouseholdId))
      : [],
  ]);

  // Dispatch on slug. Empty / ["profile"] → Household.
  const path = (slug ?? []).join("/");
  let section: ReactElement;
  if (path === "") {
    section = <PortalDashboard clientId={id} sharing={privacy} />;
  } else if (path === "profile") {
    section = <HouseholdSection clientId={id} />;
  } else if (path === "profile/family") {
    section = <FamilySection clientId={id} />;
  } else if (path === "profile/trusts") {
    section = <TrustsSection clientId={id} />;
  } else if (path === "accounts") {
    section = <PortalAccountsScreen clientId={id} />;
  } else if (path === "transactions") {
    section = privacy.shareTransactions ? (
      <TransactionsSection clientId={id} />
    ) : (
      <NotSharedNotice area="transactions" />
    );
  } else if (path === "budget") {
    section = privacy.shareBudgets ? (
      <BudgetSection clientId={id} />
    ) : (
      <NotSharedNotice area="budgets" />
    );
  } else if (path === "recurrings") {
    section = privacy.shareRecurrings ? (
      <RecurringsSection clientId={id} />
    ) : (
      <NotSharedNotice area="recurrings" />
    );
  } else if (path === "investments") {
    section = <PortalInvestmentsScreen clientId={id} />;
  } else if (path === "settings") {
    section = <PortalSettingsView privacy={privacy} readOnly />;
  } else {
    notFound();
  }

  const primary = contacts.find((c) => c.role === "primary") ?? contacts[0];
  const displayName = primary
    ? `${primary.firstName} ${primary.lastName ?? ""}`.trim()
    : "";

  const basePath = `/clients/${id}/portal/preview`;

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      {/* Full-width sticky banner — spans nav + content + detail rail. */}
      <PortalPreviewBanner
        clientId={id}
        clientName={displayName}
        editEnabled={access.client.portalEditEnabled}
      />
      <div className="grid flex-1 grid-cols-[240px_minmax(0,1fr)_auto]">
        <PortalNav
          displayName={displayName}
          email={primary?.email ?? ""}
          basePath={basePath}
        />
        <main className="border-x border-hair">
          <PortalModeProvider value={{ mode: "advisor", clientId: id }}>
            {section}
          </PortalModeProvider>
        </main>
        {/*
          Detail rail (createPortal target). `empty:hidden` collapses the slot —
          and with the `auto` third track, the empty grid column too — so the main
          content fills the full width when nothing is selected. When populated it
          reserves a fixed 420px panel.
        */}
        <aside id="portal-detail" className="w-[420px] p-4 empty:hidden" />
      </div>
    </div>
  );
}
