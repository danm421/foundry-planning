import type { ReactElement } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { requireClientAccess } from "@/lib/clients/authz";
import { nullOnAccessDenial, requireClientPortalEntitlement } from "@/lib/authz";
import OrganizerHouseholdScreen from "@/components/portal/organizer-household-screen";
import { PortalAccountsScreen } from "@/components/portal/portal-accounts-screen";
import TransactionsSection from "@/components/portal/transactions-section";
import BudgetSection from "@/components/portal/budget-section";
import RecurringsSection from "@/components/portal/recurrings-section";
import { PortalInvestmentsScreen } from "@/components/portal/portal-investments-screen";
import { PortalDocumentsScreen } from "@/components/portal/portal-documents-screen";
import PortalDashboard from "@/components/portal/portal-dashboard";
import PortalNav from "@/components/portal/portal-nav";
import OrganizerTabs from "@/components/portal/organizer-tabs";
import OrganizerGoalsScreen from "@/components/portal/organizer-goals-screen";
import OrganizerCashFlowScreen from "@/components/portal/organizer-cash-flow-screen";
import BudgetTabs from "@/components/portal/budget-tabs";
import PortalPreviewBanner from "@/components/portal/portal-preview-banner";
import { PortalModeProvider } from "@/components/portal/portal-mode-context";
import { NotSharedNotice } from "@/components/portal/not-shared-notice";
import { PortalFeatureOffNotice } from "@/components/portal/feature-off-notice";
import { PortalSettingsView } from "@/components/portal/portal-settings-view";
import { loadPortalPrivacy } from "@/lib/portal/privacy";
import { toPortalFeatures } from "@/lib/portal/features";
import { portalGreetingName } from "@/lib/portal/greeting-name";
import { portalFeatureForPath } from "@/components/portal/portal-nav-items";
import { loadPortalConnectionAlert } from "@/lib/portal/load-plaid-items";
import { resolveIntakeBrandingForClient } from "@/lib/branding/resolve-for-client";
import { PortalBrandingStrip } from "@/components/portal/portal-branding-mark";

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
  // Only an access *denial* degrades to null → notFound(); a DB fault
  // propagates and renders a 500 rather than a misleading "no such client".
  const access = await requireClientAccess(id).catch(nullOnAccessDenial);
  if (!access) notFound();

  // This renders the portal itself, so it follows the owning firm's
  // `client_portal` entitlement — 404, matching the access-denial style above.
  const entitled = await requireClientPortalEntitlement(access.firmId)
    .then(() => true)
    .catch(nullOnAccessDenial);
  if (!entitled) notFound();

  // The client's advisor-sharing switches gate the budgeting sections below.
  // Gated sections render a NotSharedNotice INSTEAD of loading data — nothing
  // the client kept private may enter this page's payload. Every read here
  // sits behind the access gate above and none depends on another.
  const [privacy, contacts, branding, connectionAlert] = await Promise.all([
    loadPortalPrivacy(id),
    access.client.crmHouseholdId
      ? db
          .select({
            firstName: crmHouseholdContacts.firstName,
            lastName: crmHouseholdContacts.lastName,
            preferredName: crmHouseholdContacts.preferredName,
            email: crmHouseholdContacts.email,
            role: crmHouseholdContacts.role,
          })
          .from(crmHouseholdContacts)
          .where(eq(crmHouseholdContacts.householdId, access.client.crmHouseholdId))
      : [],
    resolveIntakeBrandingForClient(access.firmId, access.client.advisorId),
    // Decoration only — see the note in (portal)/portal/layout.tsx.
    loadPortalConnectionAlert(id).catch(() => false),
  ]);
  const navAlerts = { "/settings": connectionAlert };

  // The advisor's own section switches, off the row `requireClientAccess`
  // already loaded. The preview must hide exactly what the client's portal
  // hides, or it stops being a preview.
  const features = toPortalFeatures(access.client);

  // Dispatch on slug. Empty → Dashboard; ["organizer"] → Household.
  const path = (slug ?? []).join("/");
  // Which switch (if any) owns this path is the navs' own mapping, so one
  // check covers `/budget`, `/budget/transactions` and `/budget/recurring`.
  const gatedBy = portalFeatureForPath(path);
  const switchedOff = gatedBy !== undefined && !features[gatedBy] ? gatedBy : undefined;
  let section: ReactElement;
  if (switchedOff !== undefined) {
    // Advisor's own switch: tell them which one, not 404 — this is the screen
    // they land on after flipping it and clicking through to check.
    section = <PortalFeatureOffNotice feature={switchedOff} viewer="advisor" />;
  } else if (path === "") {
    section = <PortalDashboard clientId={id} sharing={privacy} />;
  } else if (path === "organizer") {
    // Same component the client portal's Organizer → Household renders, so the
    // preview cannot drift from what the client actually sees. No
    // `ScrollToHash` child: nothing redirects into the preview by fragment.
    section = <OrganizerHouseholdScreen clientId={id} />;
  } else if (path === "organizer/accounts") {
    section = <PortalAccountsScreen clientId={id} />;
  } else if (path === "organizer/goals") {
    section = <OrganizerGoalsScreen clientId={id} />;
  } else if (path === "organizer/cash-flow") {
    section = <OrganizerCashFlowScreen clientId={id} />;
  } else if (path === "budget") {
    section = privacy.shareBudgets ? (
      <BudgetSection clientId={id} />
    ) : (
      <NotSharedNotice area="budgets" />
    );
  } else if (path === "budget/transactions") {
    section = privacy.shareTransactions ? (
      <TransactionsSection clientId={id} />
    ) : (
      <NotSharedNotice area="transactions" />
    );
  } else if (path === "budget/recurring") {
    section = privacy.shareRecurrings ? (
      <RecurringsSection clientId={id} />
    ) : (
      <NotSharedNotice area="recurrings" />
    );
  } else if (path === "investments") {
    section = <PortalInvestmentsScreen clientId={id} />;
  } else if (path === "documents") {
    section = <PortalDocumentsScreen editEnabled={access.client.portalEditEnabled} />;
  } else if (path === "settings") {
    section = (
      <PortalSettingsView
        privacy={privacy}
        clientId={id}
        editEnabled={access.client.portalEditEnabled}
        readOnly
      />
    );
  } else {
    notFound();
  }

  // A switched-off Budget takes its tab strip down with it, matching the
  // client portal's layout-level gate.
  const inBudget =
    switchedOff === undefined && (path === "budget" || path.startsWith("budget/"));
  const inOrganizer = path === "organizer" || path.startsWith("organizer/");

  const primary = contacts.find((c) => c.role === "primary") ?? contacts[0];
  // The banner names the client the advisor is previewing (full name, one
  // person); the rail greets the household (first names, both spouses).
  const clientName = primary
    ? `${primary.firstName} ${primary.lastName ?? ""}`.trim()
    : "";
  const greetingName = portalGreetingName(contacts);

  const basePath = `/clients/${id}/portal/preview`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
      {/* Full-width banner — spans nav + content + detail rail, stays pinned
          above the scrolling columns. */}
      <PortalPreviewBanner
        clientId={id}
        clientName={clientName}
        editEnabled={access.client.portalEditEnabled}
      />
      {/*
        The grid fills the height left below the banner (`flex-1 min-h-0`) and
        each of the three columns scrolls independently (`min-h-0 overflow-y-auto`
        against the `grid-rows-1` = minmax(0,1fr) track), so scrolling one panel
        leaves the tops of the other two in view.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_auto] grid-rows-1">
        <PortalNav
          displayName={greetingName}
          email={primary?.email ?? ""}
          basePath={basePath}
          className="flex min-h-0 overflow-y-auto"
          alerts={navAlerts}
          features={features}
        />
        <main className="min-h-0 min-w-0 overflow-y-auto border-x border-hair">
          <PortalBrandingStrip branding={branding} />
          {/* The Budget section's tab strip sits above the privacy gate, so an
              advisor can still move between tabs when one area isn't shared. */}
          {inOrganizer && <OrganizerTabs basePath={basePath} />}
          {inBudget && <BudgetTabs basePath={basePath} />}
          <PortalModeProvider value={{ mode: "advisor", clientId: id }}>
            {section}
          </PortalModeProvider>
        </main>
        {/*
          Detail rail (createPortal target). `empty:hidden` collapses the slot —
          and with the `auto` third track, the empty grid column too — so the main
          content fills the full width when nothing is selected. When populated it
          reserves a fixed 480px panel that scrolls on its own.
        */}
        <aside
          id="portal-detail"
          className="min-h-0 w-[480px] overflow-y-auto p-4 empty:hidden"
        />
      </div>
    </div>
  );
}
