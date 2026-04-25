// src/engine/scenario/applyChanges.ts
import type { ClientData } from "@/engine/types";
import type {
  ApplyChangesResult,
  CascadeWarning,
  ScenarioChange,
  TargetKind,
  ToggleGroup,
  ToggleState,
} from "./types";

export function resolveEffectiveToggleState(
  toggleState: ToggleState,
  groups: ToggleGroup[],
): ToggleState {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const effective: ToggleState = {};

  for (const group of groups) {
    const explicit = toggleState[group.id] ?? group.defaultOn;
    if (group.requiresGroupId == null) {
      effective[group.id] = explicit;
    } else {
      const parent = groupById.get(group.requiresGroupId);
      const parentEffective =
        parent != null
          ? (toggleState[parent.id] ?? parent.defaultOn)
          : true;
      effective[group.id] = explicit && parentEffective;
    }
  }

  return effective;
}

/**
 * Map from TargetKind to the ClientData property holding that entity's array.
 * Add new entries here whenever a new TargetKind is added.
 */
const TARGET_KIND_TO_FIELD: Record<TargetKind, keyof ClientData | null> = {
  account: "accounts",
  income: "incomes",
  expense: "expenses",
  liability: "liabilities",
  savings_rule: "savingsRules",
  transfer: "transfers",
  asset_transaction: "assetTransactions",
  client_deduction: "deductions",
  withdrawal_strategy: "withdrawalStrategy",
  family_member: "familyMembers",
  external_beneficiary: "externalBeneficiaries",
  gift: "gifts",
  will: "wills",
  entity: "entities",
  // Singletons: handled specially (not a list)
  client: null,
  plan_settings: null,
  // The following live on parent entities, not in ClientData top level — handled
  // by the cascade module in Tasks 11–12 since edits/removes there require
  // walking into nested structures. For Plan 1's add tests, these are never used.
  beneficiary_designation: null,
  expense_schedule_override: null,
  extra_payment: null,
  income_schedule_override: null,
  life_insurance_cash_value_schedule: null,
  life_insurance_policy: null,
  savings_schedule_override: null,
  transfer_schedule: null,
  will_bequest: null,
  will_bequest_recipient: null,
};

export function applyScenarioChanges(
  baseTree: ClientData,
  changes: ScenarioChange[],
  toggleState: ToggleState,
  groups: ToggleGroup[],
): ApplyChangesResult {
  // Deep-clone the base tree so we never mutate the caller's input.
  const tree: ClientData = structuredClone(baseTree);
  const warnings: CascadeWarning[] = [];

  const effective = resolveEffectiveToggleState(toggleState, groups);

  // Filter changes by toggle state.
  const active = changes.filter((c) => {
    if (c.toggleGroupId == null) return true;
    return effective[c.toggleGroupId] === true;
  });

  // Sort: orderIndex ascending; tie-break add → edit → remove.
  const opOrder: Record<string, number> = { add: 0, edit: 1, remove: 2 };
  const sorted = [...active].sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return opOrder[a.opType] - opOrder[b.opType];
  });

  for (const change of sorted) {
    if (change.opType === "add") {
      applyAdd(tree, change);
    }
    // edit and remove handled in subsequent tasks
  }

  return { effectiveTree: tree, warnings };
}

function applyAdd(tree: ClientData, change: ScenarioChange): void {
  const field = TARGET_KIND_TO_FIELD[change.targetKind];
  if (field == null) {
    throw new Error(
      `applyScenarioChanges: cannot 'add' for targetKind=${change.targetKind} ` +
        `(no top-level array; see TARGET_KIND_TO_FIELD)`,
    );
  }
  const arr = (tree[field] as unknown[]) ?? [];
  (tree[field] as unknown) = [...arr, change.payload];
}
