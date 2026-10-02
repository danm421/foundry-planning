// src/lib/scenario/reinvestment-picks.ts
//
// A reinvestment targets accounts picked one by one (`pickedAccountIds`) plus
// account groups (`groupKeys`). The engine reads only `accountIds`: the picks
// UNIONED with every member the groups expand to. The editors write the picks
// and the groups, never the union, so a scenario's changes get it computed
// before they apply — the engine cascade reads it, then the engine.

import type { ClientData } from "@/engine/types";
import type { ScenarioChange, ToggleGroup, ToggleState } from "@/engine/scenario/types";
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import type { AccountCategory } from "@/lib/account-groups/liquid-filter";
import { expandReinvestmentTargets } from "@/lib/projection/expand-reinvestment-targets";

type Diff = { from?: unknown; to?: unknown } | undefined;
const toOf = (entry: unknown) => (entry as Diff)?.to;

/**
 * PRE-PASS: run on a scenario's changes before `applyScenarioChanges`, by the
 * scenario load and by the promote planner. The engine cascade trims removed
 * accounts from a reinvestment's `accountIds` and drops one left with none, but
 * an add or edit carries only its picks and groups, so the cascade would read a
 * stale union: the base one an edit leaves behind, an add's from before a later
 * edit folded in, or a legacy row's leftover. Every ACTIVE reinvestment add and
 * edit is rewritten so `accountIds` is the target set it means: its picks ∪ its
 * groups' members — a default group's over the base accounts plus the active
 * added ones, a custom group's from the base load's `accountGroupMembersById`
 * map — with no removal applied yet, so the cascade itself
 * trims removed accounts and drops only a reinvestment left with none. It also
 * gets its picks key; a legacy row's `accountIds` stand in for missing picks.
 *
 * An edit of a reinvestment the scenario added is left alone (the engine skips
 * it: the add row holds the merge). With no active reinvestment add or edit the
 * very same array comes back, so such a scenario is untouched.
 */
export function withReinvestmentTargets(
  changes: ScenarioChange[],
  baseTree: Pick<ClientData, "accounts" | "reinvestments">,
  toggleState: ToggleState,
  groups: ToggleGroup[],
  customGroupMembersById: Map<string, string[]>,
): ScenarioChange[] {
  const effective = resolveEffectiveToggleState(toggleState, groups);
  const isActive = (c: ScenarioChange) => c.toggleGroupId == null || effective[c.toggleGroupId] === true;
  const isTarget = (c: ScenarioChange) =>
    c.targetKind === "reinvestment" && c.opType !== "remove" && isActive(c);
  if (!changes.some(isTarget)) return changes;

  const accountCategoryById = new Map(
    baseTree.accounts.map((a) => [a.id, a.category as AccountCategory]),
  );
  for (const c of changes) {
    const category = (c.payload as { category?: string } | null)?.category;
    if (c.targetKind === "account" && c.opType === "add" && isActive(c) && category) {
      accountCategoryById.set(c.targetId, category as AccountCategory);
    }
  }
  const union = (picks: string[], groupKeys: string[]) =>
    expandReinvestmentTargets(picks, groupKeys, { accountCategoryById, customGroupMembersById });
  const baseById = new Map((baseTree.reinvestments ?? []).map((r) => [r.id, r]));

  return changes.map((c) => {
    if (!isTarget(c)) return c;
    const p = (c.payload ?? {}) as Record<string, unknown>;
    if (c.opType === "add") {
      const picks = ((p.pickedAccountIds ?? p.accountIds) as string[] | undefined) ?? [];
      const groupKeys = (p.groupKeys as string[] | undefined) ?? [];
      return { ...c, payload: { ...p, pickedAccountIds: picks, accountIds: union(picks, groupKeys) } };
    }
    const base = baseById.get(c.targetId);
    if (!base) return c;
    const basePicks = base.pickedAccountIds ?? base.accountIds;
    const picks =
      "pickedAccountIds" in p ? toOf(p.pickedAccountIds)
      : "accountIds" in p ? toOf(p.accountIds)
      : basePicks;
    const groupKeys = "groupKeys" in p ? toOf(p.groupKeys) : base.groupKeys;
    const to = union((picks as string[] | null | undefined) ?? [], (groupKeys as string[] | null | undefined) ?? []);
    return {
      ...c,
      payload: {
        ...p,
        pickedAccountIds: { from: basePicks, to: picks ?? [] },
        accountIds: { from: base.accountIds, to },
      },
    };
  });
}
