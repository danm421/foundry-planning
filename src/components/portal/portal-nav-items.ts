/**
 * Single source of truth for the client portal's navigation destinations.
 *
 * Consumed by both the desktop side nav (`portal-nav.tsx`, grouped) and the
 * mobile top tab bar (`portal-mobile-nav.tsx`, flat). Adding a portal tab here
 * wires it into both navs at once. `suffix` is appended to a `basePath`
 * (defaults to `/portal`; the advisor preview passes its own prefix), so the
 * items stay route-prefix agnostic.
 */
export type PortalNavGroup = "profile" | "money";

export interface PortalNavItem {
  /** Visible label. */
  label: string;
  /** Route segment appended to the nav's basePath. */
  suffix: string;
  /** Section the item belongs to (drives the desktop subheader grouping). */
  group: PortalNavGroup;
}

export const PORTAL_NAV_ITEMS: readonly PortalNavItem[] = [
  { label: "Household", suffix: "/profile", group: "profile" },
  { label: "Family", suffix: "/profile/family", group: "profile" },
  { label: "Trusts", suffix: "/profile/trusts", group: "profile" },
  { label: "Accounts", suffix: "/accounts", group: "money" },
  { label: "Investments", suffix: "/investments", group: "money" },
  { label: "Transactions", suffix: "/transactions", group: "money" },
  { label: "Budget", suffix: "/budget", group: "money" },
  { label: "Recurrings", suffix: "/recurrings", group: "money" },
] as const;
