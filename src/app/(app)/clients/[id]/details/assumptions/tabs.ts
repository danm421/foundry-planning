// Sub-tab identity for the Assumptions page, kept out of the client component
// so both the component and its tests can use it without a React import.
// These ids are part of the page's URL contract -- the risk detail card links
// to `?tab=growth-inflation`. Renaming one breaks that link silently.

export const ASSUMPTIONS_TAB_IDS = [
  "tax-rates",
  "growth-inflation",
  "withdrawal",
  "deductions",
  "tax-adjustments",
  "account-groups",
] as const;

export type AssumptionsTabId = (typeof ASSUMPTIONS_TAB_IDS)[number];

export const DEFAULT_ASSUMPTIONS_TAB: AssumptionsTabId = "tax-rates";

// Typed as a mutable array of mutable objects so it assigns to the
// `tabs: Tab[]` prop on AssumptionsSubtabs.
export const ASSUMPTIONS_TABS: { id: AssumptionsTabId; label: string }[] = [
  { id: "tax-rates", label: "Tax Rates" },
  { id: "growth-inflation", label: "Growth & Inflation" },
  { id: "withdrawal", label: "Savings & Withdrawals" },
  { id: "deductions", label: "Deductions" },
  { id: "tax-adjustments", label: "Tax Adjustments" },
  { id: "account-groups", label: "Account Groups" },
];

/** The active tab for a raw `?tab=` value. Anything unrecognised, including a
 *  hand-edited URL, falls back to the default rather than rendering nothing. */
export function resolveAssumptionsTab(raw: string | null | undefined): AssumptionsTabId {
  return (ASSUMPTIONS_TAB_IDS as readonly string[]).includes(raw ?? "")
    ? (raw as AssumptionsTabId)
    : DEFAULT_ASSUMPTIONS_TAB;
}

/** The query string for switching to `tabId`, preserving every other param
 *  (notably `?scenario=`). Leading "?" included, ready for pushState. */
export function assumptionsTabQuery(current: URLSearchParams, tabId: string): string {
  const next = new URLSearchParams(current);
  next.set("tab", tabId);
  return `?${next.toString()}`;
}
