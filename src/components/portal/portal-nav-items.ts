/**
 * Single source of truth for the client portal's navigation destinations.
 *
 * Consumed by both the desktop side nav (`portal-nav.tsx`, grouped) and the
 * mobile top tab bar (`portal-mobile-nav.tsx`, flat). Adding a portal tab here
 * wires it into both navs at once. `suffix` is appended to a `basePath`
 * (defaults to `/portal`; the advisor preview passes its own prefix), so the
 * items stay route-prefix agnostic.
 */
export type PortalNavGroup = "overview" | "profile" | "money" | "settings";

export interface PortalNavItem {
  /** Visible label. */
  label: string;
  /** Route segment appended to the nav's basePath. */
  suffix: string;
  /** Section the item belongs to (drives the desktop subheader grouping). */
  group: PortalNavGroup;
  /**
   * Keep the item highlighted on its child routes too. Only for sections that
   * own sub-tabs (Budget) — the profile items are siblings, so prefix matching
   * there would light up Household on every /profile/* route.
   */
  matchNested?: boolean;
}

/**
 * Active-state test shared by both navs so the desktop rail and the mobile tab
 * strip can never disagree about which item is current.
 */
export function isPortalNavItemActive(
  pathname: string,
  href: string,
  item: PortalNavItem,
): boolean {
  if (pathname === href) return true;
  return item.matchNested === true && pathname.startsWith(`${href}/`);
}

export const PORTAL_NAV_ITEMS: readonly PortalNavItem[] = [
  { label: "Dashboard", suffix: "", group: "overview" },
  { label: "Household", suffix: "/profile", group: "profile" },
  { label: "Family", suffix: "/profile/family", group: "profile" },
  { label: "Trusts", suffix: "/profile/trusts", group: "profile" },
  { label: "Accounts", suffix: "/accounts", group: "money" },
  { label: "Investments", suffix: "/investments", group: "money" },
  // Transactions and Recurring are tabs *inside* this section, not rail
  // entries — see `BUDGET_TABS` in `budget-tabs.tsx`.
  { label: "Budget", suffix: "/budget", group: "money", matchNested: true },
  { label: "Documents", suffix: "/documents", group: "money" },
  { label: "Settings", suffix: "/settings", group: "settings" },
] as const;
