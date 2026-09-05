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
import BudgetDrawerGutter from "@/components/portal/budget-drawer-gutter";
import PortalPreviewBanner from "@/components/portal/portal-preview-banner";
import { PortalModeProvider } from "@/components/portal/portal-mode-context";
import { NotSharedNotice } from "@/components/portal/not-shared-notice";
import { PortalFeatureOffNotice } from "@/components/portal/feature-off-notice";
import { PortalSettingsView } from "@/components/portal/portal-settings-view";
import { CalculatorsScreen } from "@/components/portal/calculators-screen";
import { DebtPaydownScreen } from "@/components/portal/debt-paydown-screen";
import { SavingsGoalScreen } from "@/components/portal/savings-goal-screen";
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

  // This renders the portal itself, so it follows the CALLER'S effective
  // `client_portal` entitlement at the owning firm — that firm's setting with
  // the caller's per-user override applied. 404, matching the access-denial
  // style above.
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
  // Hoisted above the dispatch chain: the `calculators` branch below needs it,
  // and it depends only on `id`, not on `section`.
  const basePath = `/clients/${id}/portal/preview`;
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
  } else if (path === "calculators") {
    section = <CalculatorsScreen basePath={basePath} />;
  } else if (path === "calculators/debt-paydown") {
    // requireClientPortalAccess 403s any session carrying an org, so the
    // preview must never let this screen try to save on its own.
    section = <DebtPaydownScreen clientId={id} readOnly />;
  } else if (path === "calculators/savings-goal") {
    // Same reason as the paydown branch above: requireClientPortalAccess 403s
    // any session carrying an org, so the preview must never try to save.
    section = <SavingsGoalScreen clientId={id} readOnly />;
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

  // Bound once: the Budget branch below nests it inside the drawer gutter,
  // every other section renders it directly.
  const body = (
    <PortalModeProvider value={{ mode: "advisor", clientId: id }}>
      {section}
    </PortalModeProvider>
  );

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
        the nav and main columns scroll independently (`min-h-0 overflow-y-auto`
        against the `grid-rows-1` = minmax(0,1fr) track), so scrolling one panel
        leaves the top of the other in view. `relative` anchors the detail
        drawer below, which overlays this area rather than sitting in the grid.
      */}
      <div className="relative grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] grid-rows-1">
        <PortalNav
          displayName={greetingName}
          email={primary?.email ?? ""}
          basePath={basePath}
          className="flex min-h-0 overflow-y-auto"
          alerts={navAlerts}
          features={features}
        />
        <main id="main" className="min-h-0 min-w-0 overflow-y-auto border-x border-hair">
          <PortalBrandingStrip branding={branding} />
          {/* The Budget section's tab strip sits above the privacy gate, so an
              advisor can still move between tabs when one area isn't shared.
              Budget alone keeps its content out of the drawer's column; every
              other section runs full width and lets the drawer overlay it.
              The two strips never both apply — a path is one section or the
              other — so Organizer stays outside the Budget branch. */}
          {inOrganizer && <OrganizerTabs basePath={basePath} />}
          {inBudget ? (
            <BudgetDrawerGutter>
              <BudgetTabs basePath={basePath} />
              {body}
            </BudgetDrawerGutter>
          ) : (
            body
          )}
        </main>
        {/*
          Detail drawer (createPortal target) — mirrors the client layout: taken
          out of the grid so it slides OVER the right of the page instead of
          narrowing the content beside it. `empty:hidden` keeps it out of the
          way when nothing is selected. The Budget tabs opt out of the overlay
          by reserving a matching column (see budget-drawer-gutter) — change
          the width here and you must change it there.
        */}
        <aside
          id="portal-detail"
          className="portal-drawer absolute inset-y-0 right-0 z-30 w-[480px] overflow-y-auto border-l border-hair bg-paper p-4 shadow-xl empty:hidden"
        />
      </div>
    </div>
  );
}
