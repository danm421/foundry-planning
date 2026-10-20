// src/lib/solver/year-detail-edit-target.ts
//
// Which plan item a row of the Solver's Cash Flow year breakdown opens — in the
// same Details editor the Changes tab's Edit opens, so a save lands as a
// scenario change. A row's id is whatever the engine keyed that year's dollars
// by: usually the plan row's own id, but a synthesized row (a policy premium, a
// purchase's mortgage, a property tax) carries a prefix in front of the id of
// the row that made it. Rows with no plan item behind them (taxes, Medicare
// premiums, a balancing "Other") and items the Changes tab can't open resolve
// to null.

import type { ClientData } from "@/engine/types";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import { NOT_YET_READY } from "@/lib/scenario/plan-detail-catalog";

// Strip one of these and the rest of the id is the plan row behind it. Where
// one prefix starts another, the longer one comes first.
const SOURCE_PREFIXES = [
  "technique-proceeds:", // buy/sell net proceeds → the asset transaction
  "life-insurance-proceeds:", // death benefit → the life policy
  "annuity:", // annuity contract income → the account
  "equity-proceeds:", // stock option net cash → the account
  "synth-proptax-technique-acct-", // a purchase's property tax → the asset transaction
  "synth-proptax-", // property tax → the real-estate account
  "technique-liab-", // a purchase's mortgage → the asset transaction
  "disability-premium-",
  "ltc-premium-",
  "premium-", // life premium → the life policy
  "policy-income-", // life policy income schedule → the life policy
  "disability-benefit-",
  "ltc-benefit-",
];

function sourceRowId(itemId: string): string {
  const prefix = SOURCE_PREFIXES.find((p) => itemId.startsWith(p));
  return prefix ? itemId.slice(prefix.length) : itemId;
}

/**
 * Resolver for one projection year: `(categoryKey, itemId)` → the inventory
 * item to edit, or null. `inventory` is the persisted plan's (only those rows
 * open); `tree` is the plan the breakdown was built from.
 */
export function yearDetailEditResolver(
  inventory: InventoryItem[],
  tree: ClientData,
  year: number,
): (categoryKey: string, itemId: string) => InventoryItem | null {
  const openable = new Map<string, InventoryItem>();
  const byRowId = new Map<string, InventoryItem>();
  for (const i of inventory) {
    if (!i.canEdit || NOT_YET_READY.has(i.typeKey)) continue;
    openable.set(i.key, i);
    byRowId.set(i.id, i);
  }

  return (categoryKey, itemId) => {
    // Savings are keyed by the account they fund; the rule funding it that year
    // is what the advisor edits.
    if (categoryKey === "savings") {
      const rule = (tree.savingsRules ?? []).find(
        (r) => r.accountId === itemId && r.startYear <= year && year <= r.endYear,
      );
      return rule ? (openable.get(`savings_rule:${rule.id}`) ?? null) : null;
    }
    return byRowId.get(sourceRowId(itemId)) ?? null;
  };
}
