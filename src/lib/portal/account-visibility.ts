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
import type { Account } from "@/engine/types";

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

/**
 * `Account` → `PortalAccountVisibility`, coalescing the two optional engine
 * columns (`isDefaultChecking`, `parentAccountId`) this shape requires as
 * non-optional. Every caller that needs a `PortalAccountVisibility` from a
 * real `Account` — the Organizer map loader (Task 4) and the portal
 * savings-rule write route (Task 7) each build one independently — goes
 * through this ONE coalescing site. That is what keeps the fail-closed
 * property real: `Account.isDefaultChecking`/`parentAccountId` are optional
 * on the engine type, so a caller that reached for its own `?? false`/`?? null`
 * (or a bare cast) could silently reintroduce the permissive default the
 * Task 3 review closed. Co-located here, next to the type and predicate it
 * feeds, instead of duplicated per call site.
 */
export function toPortalAccountVisibility(
  a: Pick<Account, "category" | "isDefaultChecking" | "parentAccountId">,
): PortalAccountVisibility {
  return {
    category: a.category,
    isDefaultChecking: a.isDefaultChecking ?? false,
    parentAccountId: a.parentAccountId ?? null,
  };
}
