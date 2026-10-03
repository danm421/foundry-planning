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
import { loadClientDataWithContext } from "@/lib/projection/load-client-data";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import type {
  CascadeWarning,
  TargetKind,
  ToggleGroup,
} from "@/engine/scenario/types";
import { describeChangeTarget } from "@/lib/scenario/describe-change-target";
import { withoutBusinessCashRiders } from "@/lib/scenario/business-cash-rider";

export interface PanelData {
  scenarioId: string;
  scenarioName: string;
  changes: ChangesPanelChange[];
  toggleGroups: ToggleGroup[];
  cascadeWarnings: CascadeWarning[];
  /** `${targetKind}:${targetId}` → entity display name, so leaf rows can
   *  render "Salary" instead of the raw UUID. Read from the effective tree,
   *  with the base tree filling in what the scenario no longer contains — an
   *  op=remove target is named after the item it removed. */
  targetNames: Record<string, string>;
}

export async function loadPanelData(
  clientId: string,
  scenarioId: string,
  firmId: string,
): Promise<PanelData | null> {
  const client = await findClientInFirm(clientId, firmId);
  if (!client) return null;

  const [scenarioRow, changeRows, groupRows, effective, base] = await Promise.all([
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
    // cache()-shared with the base load `loadEffectiveTree` already makes.
    loadClientDataWithContext(clientId, firmId),
  ]);

  if (!scenarioRow || scenarioRow.isBaseCase) return null;

  // A scenario business's "<name> — Cash" account is part of the business, not
  // a change of its own — it never gets a row.
  const changes: ChangesPanelChange[] = withoutBusinessCashRiders(changeRows).map((r) => ({
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
    label: r.label,
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
    targetNames: {
      ...buildTargetNames(base.clientData, clientId),
      ...buildTargetNames(effective.effectiveTree, clientId),
    },
  };
}

export function buildTargetNames(
  tree: Awaited<ReturnType<typeof loadEffectiveTree>>["effectiveTree"],
  clientId: string,
): Record<string, string> {
  const names: Record<string, string> = {};
  const accountsById = new Map<string, { name: string }>(
    (tree.accounts ?? []).map((a) => [a.id, { name: a.name }]),
  );
  const clientFirstName = tree.client?.firstName ?? null;

  const put = (kind: TargetKind, items: ReadonlyArray<{ id: string }> | undefined) => {
    for (const it of items ?? []) {
      const label = describeChangeTarget(kind, it, accountsById, clientFirstName);
      if (label) names[`${kind}:${it.id}`] = label;
    }
  };

  put("account", tree.accounts);
  put("income", tree.incomes);
  put("expense", tree.expenses);
  put("liability", tree.liabilities);
  put("savings_rule", tree.savingsRules);
  put("transfer", tree.transfers);
  put("asset_transaction", tree.assetTransactions);
  put("reinvestment", tree.reinvestments);
  put("roth_conversion", tree.rothConversions);
  put("gift", tree.gifts);
  put("will", tree.wills);
  put("family_member", tree.familyMembers);
  put("relocation", tree.relocations);
  put("external_beneficiary", tree.externalBeneficiaries);
  put("entity", tree.entities);
  put("client_deduction", tree.deductions as unknown as ReadonlyArray<{ id: string }>);
  put("client_tax_adjustment", tree.taxAdjustments as unknown as ReadonlyArray<{ id: string }>);
  put("disability_policy", tree.disabilityPolicies ?? []);
  put("ltc_event", tree.ltcEvents);
  put("stress_test", tree.stressTests);

  if (clientFirstName) names[`client:${clientId}`] = clientFirstName;
  // Plan settings have no name of their own; they're edited on the Assumptions page.
  names[`plan_settings:${clientId}`] = "Assumptions";
  return names;
}
