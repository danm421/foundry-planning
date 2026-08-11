import type { ReactElement, ReactNode } from "react";
import { requireClientPortalAccess } from "@/lib/authz";
import { isPortalFeatureEnabled } from "@/lib/portal/load-features";
import { PortalFeatureOffNotice } from "@/components/portal/feature-off-notice";
import BudgetTabs from "@/components/portal/budget-tabs";

/**
 * Chrome for the Budget section: the tab strip that navigates between Budget,
 * Transactions and Recurring — plus the one gate that covers all three tabs.
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
    <>
      <BudgetTabs />
      {children}
    </>
  );
}
