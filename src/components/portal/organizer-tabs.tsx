import type { ReactElement } from "react";
import PortalTabStrip, { type PortalTab } from "@/components/portal/portal-tab-strip";

/**
 * The Organizer section's own top-level navigation. Household, Family, Trusts
 * and Accounts used to be four siblings in the portal's left rail; they are now
 * one rail entry ("Organizer") whose tabs live here — Family and Trusts folded
 * into the Household tab as page sections.
 *
 * Each tab is its own route, so deep links and the back button keep working.
 * `suffix` is appended to `<basePath>/organizer` exactly as `BUDGET_TABS`
 * appends to `<basePath>/budget`; the advisor preview passes its own prefix.
 *
 * Four tabs, not six: `portal-mobile-nav` is itself a horizontally scrolling
 * strip, and a six-tab strip under a six-entry one puts two competing scroll
 * affordances on the same screen.
 */
export const ORGANIZER_TABS: readonly PortalTab[] = [
  { label: "Household", suffix: "" },
  { label: "Accounts", suffix: "/accounts" },
  { label: "Goals", suffix: "/goals" },
  { label: "Cash Flow", suffix: "/cash-flow" },
];

export default function OrganizerTabs({
  basePath = "/portal",
}: {
  basePath?: string;
}): ReactElement {
  return (
    <PortalTabStrip
      root={`${basePath}/organizer`}
      tabs={ORGANIZER_TABS}
      label="Organizer sections"
    />
  );
}
