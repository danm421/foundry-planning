import type { ReactElement, ReactNode } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { isPortalFeatureEnabled } from "@/lib/portal/load-features";
import { PortalFeatureOffNotice } from "@/components/portal/feature-off-notice";
import BudgetTabs from "@/components/portal/budget-tabs";
import BudgetDrawerGutter from "@/components/portal/budget-drawer-gutter";

/**
 * Chrome for the Budget section: the tab strip that navigates between Budget,
 * Transactions and Recurring — plus the one gate that covers all three tabs.
 *
 * Everything below the gate sits in the drawer gutter, so the detail panel
 * gets a column of its own here instead of covering the tabs and their
 * content the way it does elsewhere in the portal.
 *
 * The feature check lives here rather than in each page so a switched-off
 * Budget takes the tab strip down with it; a page-level check would leave the
 * tabs framing the section-off notice. Each tab's page still does its own
 * `requireClientPortalAccess()` — this layout does not pass a clientId down.
 */
export default async function BudgetLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const { clientId } = await requireClientPortalAccess();
  if (!(await isPortalFeatureEnabled(clientId, "budget"))) {
    return <PortalFeatureOffNotice feature="budget" viewer="client" />;
  }

  return (
    <BudgetDrawerGutter>
      <BudgetTabs />
      {children}
    </BudgetDrawerGutter>
  );
}
