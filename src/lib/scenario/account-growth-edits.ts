// src/lib/scenario/account-growth-edits.ts
//
// A scenario `edit` of an account is applied field by field onto the account
// `loadClientData` already RESOLVED, so an edit of a growth input never reaches
// the resolved `growthRate` / `realization` the engine reads: a flip back to the
// plan default kept the old custom rate, and the account form's
// `growthRate: null` zeroed growth outright. An `add` is resolved through
// `resolveAccountFromRaw` (`resolveAddPayload`); this gives an edit the same.
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import type { ScenarioChange, ToggleGroup, ToggleState } from "@/engine/scenario/types";
import type { Account } from "@/engine/types";
import { resolveAccountFromRaw, type ResolutionContext } from "@/lib/projection/resolve-entity";

/** The raw keys `resolveAccountFromRaw` reads to resolve an account's growth —
 *  its rate and realization — and its property-tax growth. */
const ACCOUNT_GROWTH_KEYS = [
  "category",
  "growthSource",
  "growthRate",
  "modelPortfolioId",
  "tickerPortfolioId",
  "turnoverPct",
  "overridePctOi",
  "overridePctLtCg",
  "overridePctQdiv",
  "overridePctTaxExempt",
  "propertyTaxGrowthSource",
  "propertyTaxGrowthRate",
] as const;

/**
 * Re-resolve the growth of every account an ACTIVE edit changed a growth input
 * of, from the account as the scenario has it: the base account (which keeps its
 * raw `growthSource` and `modelPortfolioId`, and the rate the edit was diffed
 * against) with the edit's `to` values on top. Only the resolved growth fields
 * are replaced, so the edit's other fields stand.
 *
 * Active means what `applyScenarioChanges` means, so an edit in a switched-off
 * group changes nothing. An edit of a scenario-added account is skipped:
 * `applyScenarioChanges` ignores it, and the add was resolved already. Returns
 * the same array when no edit qualifies.
 */
export function reResolveEditedAccountGrowth(
  accounts: Account[],
  changes: ScenarioChange[],
  toggleState: ToggleState,
  groups: ToggleGroup[],
  ctx: ResolutionContext,
): Account[] {
  const effective = resolveEffectiveToggleState(toggleState, groups);
  const isAccount = (c: ScenarioChange) => c.targetKind === "account";
  const addedIds = new Set(changes.filter((c) => isAccount(c) && c.opType === "add").map((c) => c.targetId));
  const ids = new Set(
    changes
      .filter(
        (c) =>
          isAccount(c) &&
          c.opType === "edit" &&
          !addedIds.has(c.targetId) &&
          (c.toggleGroupId == null || effective[c.toggleGroupId] === true) &&
          ACCOUNT_GROWTH_KEYS.some((k) => Object.hasOwn((c.payload ?? {}) as object, k)),
      )
      .map((c) => c.targetId),
  );
  if (ids.size === 0) return accounts;

  return accounts.map((a) => {
    if (!ids.has(a.id)) return a;
    const resolved = resolveAccountFromRaw(a as never, ctx);
    return {
      ...a,
      growthRate: resolved.growthRate,
      realization: resolved.realization,
      propertyTaxGrowthRate: resolved.propertyTaxGrowthRate,
    };
  });
}
