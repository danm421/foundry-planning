// src/lib/scenario/reinvestment-picks.ts
//
// A reinvestment targets accounts picked one by one (`pickedAccountIds`) plus
// account groups (`groupKeys`). The engine reads only `accountIds`: the picks
// UNIONED with every member the groups expand to. The editors write the picks
// and the groups, never the union, so the scenario overlay recomputes it.

import type { Account, Reinvestment } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { AccountCategory } from "@/lib/account-groups/liquid-filter";
import { expandReinvestmentTargets } from "@/lib/projection/expand-reinvestment-targets";

/**
 * A reinvestment `add` / `edit` written before `pickedAccountIds` existed
 * carries its picks in `accountIds`. Read them as the picks, so the row keeps
 * meaning what it meant once the union is recomputed from the picks. An edit's
 * `{from, to}` pair carries over as is.
 */
export function withLegacyReinvestmentPicks(change: ScenarioChange): ScenarioChange {
  if (change.targetKind !== "reinvestment" || change.opType === "remove") return change;
  const payload = change.payload as Record<string, unknown> | null;
  if (!payload || "pickedAccountIds" in payload || !("accountIds" in payload)) return change;
  return { ...change, payload: { ...payload, pickedAccountIds: payload.accountIds } };
}

/**
 * Each reinvestment's `accountIds` = its picks still among `accounts` ∪ the
 * members of its groups among `accounts`. A picked account the scenario removed
 * stays out (the cascade has already trimmed it from `accountIds`). One with no
 * picks key keeps its own `accountIds` as the picks.
 */
export function withExpandedReinvestmentTargets(
  reinvestments: Reinvestment[],
  accounts: Pick<Account, "id" | "category">[],
  customGroupMembersById: Map<string, string[]>,
): Reinvestment[] {
  const accountCategoryById = new Map(
    accounts.map((a) => [a.id, a.category as AccountCategory]),
  );
  return reinvestments.map((r) => ({
    ...r,
    accountIds: expandReinvestmentTargets(
      (r.pickedAccountIds ?? r.accountIds).filter((id) => accountCategoryById.has(id)),
      r.groupKeys ?? [],
      { accountCategoryById, customGroupMembersById },
    ),
  }));
}
