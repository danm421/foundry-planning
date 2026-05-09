// src/lib/scenario/load-panel-data.ts
//
// Shared loader for the Changes panel's server-side fetch. Used by the
// client-data layout shell (which mounts the panel as a right rail) and by
// the comparison page (which mounts it inside a slide-out drawer per scenario).
//
// Returns null when the scenario id is bogus, doesn't belong to this firm, or
// resolves to the base case — the panel is suppressed for base since there's
// nothing to revert.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  scenarios,
  scenarioChanges,
  scenarioToggleGroups,
} from "@/db/schema";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import type {
  CascadeWarning,
  TargetKind,
  ToggleGroup,
} from "@/engine/scenario/types";

export interface PanelData {
  scenarioId: string;
  scenarioName: string;
  changes: ChangesPanelChange[];
  toggleGroups: ToggleGroup[];
  cascadeWarnings: CascadeWarning[];
  /** `${targetKind}:${targetId}` → entity display name, derived from the
   *  effective tree so leaf rows can render "Income — Salary" instead of
   *  the raw UUID slice. Entities the effective tree no longer contains
   *  (e.g. an op=remove target) gracefully fall back to the UUID slice. */
  targetNames: Record<string, string>;
}

export async function loadPanelData(
  clientId: string,
  scenarioId: string,
  firmId: string,
): Promise<PanelData | null> {
  const client = await findClientInFirm(clientId, firmId);
  if (!client) return null;

  const [scenarioRow, changeRows, groupRows, effective] = await Promise.all([
    db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, scenarioId)),
    db
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.scenarioId, scenarioId))
      .orderBy(scenarioToggleGroups.orderIndex),
    loadEffectiveTree(clientId, firmId, scenarioId, {}),
  ]);

  if (!scenarioRow || scenarioRow.isBaseCase) return null;

  const changes: ChangesPanelChange[] = changeRows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    opType: r.opType,
    targetKind: r.targetKind as TargetKind,
    targetId: r.targetId,
    payload: r.payload,
    toggleGroupId: r.toggleGroupId,
    orderIndex: r.orderIndex,
    updatedAt: r.updatedAt,
    enabled: r.enabled,
  }));

  const toggleGroups: ToggleGroup[] = groupRows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    name: r.name,
    defaultOn: r.defaultOn,
    requiresGroupId: r.requiresGroupId,
    orderIndex: r.orderIndex,
  }));

  return {
    scenarioId,
    scenarioName: scenarioRow.name,
    changes,
    toggleGroups,
    cascadeWarnings: effective.warnings,
    targetNames: buildTargetNames(effective.effectiveTree, clientId),
  };
}

function buildTargetNames(
  tree: Awaited<ReturnType<typeof loadEffectiveTree>>["effectiveTree"],
  clientId: string,
): Record<string, string> {
  const names: Record<string, string> = {};
  const put = (
    kind: TargetKind,
    items: { id: string; name?: string | null }[],
  ) => {
    for (const it of items) {
      if (it.name) names[`${kind}:${it.id}`] = it.name;
    }
  };
  put("account", tree.accounts);
  put("income", tree.incomes);
  put("expense", tree.expenses);
  put("liability", tree.liabilities);
  put("savings_rule", tree.savingsRules);
  if (tree.transfers) {
    put("transfer", tree.transfers as { id: string; name?: string }[]);
  }
  if (tree.assetTransactions) {
    put("asset_transaction", tree.assetTransactions as { id: string; name?: string }[]);
  }
  if (tree.gifts) put("gift", tree.gifts as { id: string; name?: string }[]);
  if (tree.wills) put("will", tree.wills as { id: string; name?: string }[]);
  if (tree.familyMembers) put("family_member", tree.familyMembers);
  if (tree.externalBeneficiaries) {
    put("external_beneficiary", tree.externalBeneficiaries);
  }
  if (tree.entities) {
    put("entity", tree.entities as unknown as { id: string; name?: string }[]);
  }
  if (tree.deductions) {
    put("client_deduction", tree.deductions as unknown as { id: string; name?: string }[]);
  }
  if (tree.client?.firstName) {
    names[`client:${clientId}`] = tree.client.firstName;
  }
  return names;
}
