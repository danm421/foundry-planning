/**
 * Portal account visibility — the single source of truth for which accounts a
 * client may see and mutate on the client portal.
 *
 * Lean bank-style view (Phase 1 spec): clients see only real cash, investment
 * (taxable/retirement), and real-estate accounts. Hidden:
 *  - engine cash-flow buckets (`isDefaultChecking`: Household Cash, <Entity> — Cash)
 *  - business sub-accounts (`parentAccountId` set)
 *  - advisor-only planning categories (business, annuity, life_insurance,
 *    notes_receivable, stock_options)
 *
 * Used by the portal accounts list (filter) AND the portal account
 * POST/PUT/DELETE routes (guards) so the UI and API never disagree.
 */
export const PORTAL_VISIBLE_CATEGORIES = [
  "cash",
  "taxable",
  "retirement",
  "real_estate",
] as const;

export function isPortalVisibleCategory(category: string): boolean {
  return (PORTAL_VISIBLE_CATEGORIES as readonly string[]).includes(category);
}

export interface PortalAccountVisibility {
  category: string;
  isDefaultChecking: boolean;
  parentAccountId: string | null;
}

export function isPortalVisibleAccount(a: PortalAccountVisibility): boolean {
  if (a.isDefaultChecking) return false;
  if (a.parentAccountId != null) return false;
  return isPortalVisibleCategory(a.category);
}
