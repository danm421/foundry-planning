// src/lib/scenario/reinvestment-picks.ts
//
// A reinvestment targets accounts picked one by one (`pickedAccountIds`) plus
// account groups (`groupKeys`). The engine reads only `accountIds`: the picks
// UNIONED with every member the groups expand to. The editors write the picks
// and the groups, never the union, so a scenario's changes get it computed
// before they apply — the engine cascade reads it, then the engine.

import type { ClientData, Reinvestment } from "@/engine/types";
import type { ScenarioChange, ToggleGroup, ToggleState } from "@/engine/scenario/types";
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";
import type { AccountCategory } from "@/lib/account-groups/liquid-filter";
import { isSyntheticEntityChecking } from "@/lib/entities/entity-checking";
import { expandReinvestmentTargets } from "@/lib/projection/expand-reinvestment-targets";

type Diff = { from?: unknown; to?: unknown } | undefined;
const toOf = (entry: unknown) => (entry as Diff)?.to;
const isGrouped = (r: Reinvestment) => (r.groupKeys ?? []).length > 0;

/**
 * PRE-PASS: run on a scenario's changes and tree before `applyScenarioChanges`,
 * by the scenario load and by the promote planner. The engine cascade trims
 * removed accounts from a reinvestment's `accountIds` and drops one left with
 * none, so it must read the target set each reinvestment means — before any
 * removal applies, so the cascade itself does the trimming and dropping:
 *
 *   • Every ACTIVE reinvestment add and edit gets `accountIds` = its picks ∪
 *     its groups' members (plus its picks key; a legacy row's `accountIds`
 *     stand in for missing picks). Otherwise the cascade reads a stale union:
 *     the base one an edit leaves behind, an add's from before a later edit
 *     folded in, or a legacy row's leftover. An edit of a reinvestment the
 *     scenario added is left alone (the engine skips it: the add row holds
 *     the merge).
 *   • When the scenario has ACTIVE account adds, every grouped base
 *     reinvestment on the returned tree gets the same union, because a group
 *     is a live reference that base re-expands on every load: an added account
 *     joins it whether or not the scenario also edits the reinvestment. (An
 *     active edit's own union replaces this one.)
 *
 * Groups expand over the base accounts plus the active added ones; a custom
 * group's members come from the base load's `accountGroupMembersById` map,
 * kept to those accounts. Synthesized entity-checking accounts are skipped:
 * the base load expands groups over the stored accounts, before
 * `withSynthesizedEntityChecking` adds them, so the scenario load (whose tree
 * has none) and the promote planner (whose base tree has them) expand alike.
 *
 * With no active reinvestment add or edit and no active account add, the very
 * same changes and tree come back, so such a scenario is untouched.
 */
export function withReinvestmentTargets(
  changes: ScenarioChange[],
  baseTree: ClientData,
  toggleState: ToggleState,
  groups: ToggleGroup[],
  customGroupMembersById: Map<string, string[]>,
): { changes: ScenarioChange[]; tree: ClientData } {
  const effective = resolveEffectiveToggleState(toggleState, groups);
  const isActive = (c: ScenarioChange) => c.toggleGroupId == null || effective[c.toggleGroupId] === true;
  const isTarget = (c: ScenarioChange) =>
    c.targetKind === "reinvestment" && c.opType !== "remove" && isActive(c);
  const accountAdds = changes.filter(
    (c) => c.targetKind === "account" && c.opType === "add" && isActive(c),
  );
  const rewritesChanges = changes.some(isTarget);
  const rewritesTree = accountAdds.length > 0 && (baseTree.reinvestments ?? []).some(isGrouped);
  if (!rewritesChanges && !rewritesTree) return { changes, tree: baseTree };

  const accountCategoryById = new Map(
    baseTree.accounts
      .filter((a) => !isSyntheticEntityChecking(a.id))
      .map((a) => [a.id, a.category as AccountCategory]),
  );
  for (const c of accountAdds) {
    const category = (c.payload as { category?: string } | null)?.category;
    if (category) accountCategoryById.set(c.targetId, category as AccountCategory);
  }
  const existingMembersById = new Map(
    [...customGroupMembersById].map(([key, ids]) => [key, ids.filter((id) => accountCategoryById.has(id))]),
  );
  const union = (picks: string[], groupKeys: string[]) =>
    expandReinvestmentTargets(picks, groupKeys, {
      accountCategoryById,
      customGroupMembersById: existingMembersById,
    });
  const baseReinvestments = baseTree.reinvestments ?? [];
  const baseById = new Map(baseReinvestments.map((r) => [r.id, r]));

  const tree = rewritesTree
    ? {
        ...baseTree,
        reinvestments: baseReinvestments.map((r) =>
          isGrouped(r) ? { ...r, accountIds: union(r.pickedAccountIds ?? r.accountIds, r.groupKeys!) } : r,
        ),
      }
    : baseTree;

  const rewrite = (c: ScenarioChange): ScenarioChange => {
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
  };
  return { changes: rewritesChanges ? changes.map(rewrite) : changes, tree };
}
