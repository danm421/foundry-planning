// src/lib/projection/expand-reinvestment-targets.ts
//
// Pure union expander for reinvestment account targets. A reinvestment targets
// some individually-selected accounts PLUS some account-group keys (default
// keys like "all-liquid"/"taxable", or custom group UUIDs). This resolves the
// group keys to their current liquid member accounts and unions everything.
//
// Used at the projection-load boundary (live group reference: re-expanded every
// load) and by the form's solver-draft path (so the in-memory draft carries the
// correct expanded accountIds). Framework-free — safe on client and server.

import { isLiquid, type AccountCategory } from "@/lib/account-groups/liquid-filter";
import { isDefaultKey } from "@/lib/account-groups/resolver";

export interface ExpandReinvestmentTargetsDeps {
  /** Category for every account in scope (used to expand default keys). */
  accountCategoryById: Map<string, AccountCategory>;
  /** Liquid member account ids per custom group UUID. */
  customGroupMembersById: Map<string, string[]>;
}

export function expandReinvestmentTargets(
  individualAccountIds: readonly string[],
  groupKeys: readonly string[],
  deps: ExpandReinvestmentTargetsDeps,
): string[] {
  const out = new Set<string>(individualAccountIds);
  for (const key of groupKeys) {
    if (isDefaultKey(key)) {
      for (const [accountId, category] of deps.accountCategoryById) {
        const match = key === "all-liquid" ? isLiquid(category) : category === key;
        if (match) out.add(accountId);
      }
    } else {
      for (const accountId of deps.customGroupMembersById.get(key) ?? []) {
        out.add(accountId);
      }
    }
  }
  return [...out];
}
