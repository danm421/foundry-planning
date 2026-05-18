import type { Account, EntitySummary } from "../types";

/**
 * Canonical business-entity total value (Sub-project A's rule): flat operating
 * value (`entity.value`) plus every account slice the entity owns — default
 * cash and partial slices of mixed accounts included. Each slice uses the
 * locked `entityAccountSharesEoY` value when available, else `balance × pct`.
 *
 * This is the single source of truth shared by `computeGrossEstate`'s
 * business-consolidation loop and `applyBusinessSuccession` — keep both callers
 * on this helper so the gross-estate line and the routed transfer cannot drift.
 */
export function businessConsolidatedValue(
  entity: EntitySummary,
  accounts: Account[],
  accountBalances: Record<string, number>,
  entityAccountSharesEoY: Map<string, Map<string, number>> | undefined,
): number {
  let total = entity.value ?? 0;
  for (const a of accounts) {
    const bal = accountBalances[a.id] ?? 0;
    // Accounts fully drained to zero are excluded even if a locked EoY share
    // exists — consistent with the computeGrossEstate account loop.
    if (bal <= 0) continue;
    for (const o of a.owners) {
      if (o.kind !== "entity" || o.entityId !== entity.id) continue;
      const locked = entityAccountSharesEoY?.get(entity.id)?.get(a.id);
      total += locked ?? bal * o.percent;
    }
  }
  return total;
}
