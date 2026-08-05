import type { ReactElement } from "react";
import PortalTabStrip, { type PortalTab } from "@/components/portal/portal-tab-strip";

/**
 * The Budget section's own top-level navigation. Budget, Transactions and
 * Recurring used to be three siblings in the portal's left rail; they are now
 * one rail entry ("Budget") whose three tabs live here.
 *
 * Each tab is its own route, so deep links and the back button keep working.
 * `suffix` is appended to `<basePath>/budget` the same way `PORTAL_NAV_ITEMS`
 * appends to `basePath` — the advisor preview passes its own prefix.
 */
export const BUDGET_TABS: readonly PortalTab[] = [
  { label: "Budget", suffix: "" },
  { label: "Transactions", suffix: "/transactions" },
  { label: "Recurring", suffix: "/recurring" },
];

export default function BudgetTabs({
  basePath = "/portal",
}: {
  basePath?: string;
}): ReactElement {
  return (
    <PortalTabStrip root={`${basePath}/budget`} tabs={BUDGET_TABS} label="Budget sections" />
  );
}
