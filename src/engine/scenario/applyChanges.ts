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
import { resolveCascades, type RemovedRef } from "./cascadeResolution";

export function resolveEffectiveToggleState(
  toggleState: ToggleState,
  groups: ToggleGroup[],
): ToggleState {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const effective: ToggleState = {};

  // Resolve a group's effective state by walking the requiresGroupId chain
  // transitively: a group is ON only if its own explicit state is on AND every
  // ancestor up the chain is effectively on. Memoized into `effective` so each
  // group is computed once (O(n)). `inFlight` guards against cycles — the write
  // path forbids them, but the schema allows them structurally, so a defensive
  // guard keeps a malformed row from spinning the engine.
  const inFlight = new Set<string>();
  const resolve = (group: ToggleGroup): boolean => {
    if (group.id in effective) return effective[group.id];
    const explicit = toggleState[group.id] ?? group.defaultOn;
    if (group.requiresGroupId == null) {
      effective[group.id] = explicit;
      return explicit;
    }
    const parent = groupById.get(group.requiresGroupId);
    // Unknown parent (dangling ref) is treated as on, matching the prior
    // single-level behavior. A cycle short-circuits to the explicit state to
    // avoid infinite recursion.
    if (parent == null || inFlight.has(group.id)) {
      effective[group.id] = explicit;
      return explicit;
    }
    inFlight.add(group.id);
    const parentEffective = resolve(parent);
    inFlight.delete(group.id);
    const result = explicit && parentEffective;
    effective[group.id] = result;
    return result;
  };

  for (const group of groups) {
    resolve(group);
  }

  return effective;
}

/**
 * Map from TargetKind to the ClientData property holding that entity's array.
 * Add new entries here whenever a new TargetKind is added.
 */
// Forms send decimal fields as strings (matching the base POST shape that
// round-trips through Drizzle decimal columns and gets `parseFloat`'d in
// `loadClientData`). Scenario `add`/`edit` payloads bypass that loader, so
// applyChanges has to coerce or numeric-string values reach the engine and
// poison every `+` reduction. Keep aligned with `loadClientData`.
const NUMERIC_FIELDS_BY_KIND: Partial<Record<TargetKind, readonly string[]>> = {
  account: [
    "value",
    "basis",
    "growthRate",
    "annualPropertyTax",
    "propertyTaxGrowthRate",
    "turnoverPct",
    "overridePctOi",
    "overridePctLtCg",
    "overridePctQdiv",
    "overridePctTaxExempt",
  ],
  income: ["annualAmount", "growthRate", "piaMonthly"],
  expense: ["annualAmount", "growthRate"],
  liability: ["balance", "interestRate", "monthlyPayment"],
  savings_rule: [
    "annualAmount",
    "annualPercent",
    "growthRate",
    "employerMatchPct",
    "employerMatchCap",
    "employerMatchAmount",
  ],
  client_deduction: ["annualAmount", "growthRate"],
  roth_conversion: ["fixedAmount", "fillUpBracket", "indexingRate"],
  asset_transaction: ["fractionSold"],
  // Scenario reinvestment payloads are RAW-shaped (the engine `Reinvestment`
  // type carries the raw resolution inputs). `year` is an integer, so it is
  // omitted — consistent with how `roth_conversion` omits `startYear`.
  reinvestment: [
    "customGrowthRate",
    "customPctOrdinaryIncome",
    "customPctLtCapitalGains",
    "customPctQualifiedDividends",
    "customPctTaxExempt",
  ],
  // Solver gift overlays carry an EstateFlowGift draft. These flat numeric fields
  // are coerced before normalizeScenarioGifts re-derives giftEvents.
  relocation: ["year"],
  gift: ["year", "amount", "percent", "amountOverride", "startYear", "endYear", "annualAmount"],
  entity: ["value", "basis", "valueGrowthRate", "distributionAmount", "distributionPercent", "exemptionConsumed", "grantorStatusEndYear"],
  // The withdrawal-strategy form posts startYear/endYear as strings
  // (String(...) in withdrawal-strategy-section.tsx), so coerce them before the
  // engine's year-window filter (year >= s.startYear && year <= s.endYear) and
  // the priorityOrder sort run on string values. priorityOrder is already a
  // number; listing it is a harmless safety no-op.
  withdrawal_strategy: ["priorityOrder", "startYear", "endYear"],
};

function toNumberIfNumericString(v: unknown): unknown {
  if (typeof v !== "string" || v === "") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function coerceEntityNumerics(
  targetKind: TargetKind,
  entity: Record<string, unknown>,
): Record<string, unknown> {
  const fields = NUMERIC_FIELDS_BY_KIND[targetKind];
  if (!fields) return entity;
  const out: Record<string, unknown> = { ...entity };
  for (const f of fields) {
    if (f in out) out[f] = toNumberIfNumericString(out[f]);
  }
  return out;
}

function coerceEditValue(
  targetKind: TargetKind,
  fieldName: string,
  v: unknown,
): unknown {
  const fields = NUMERIC_FIELDS_BY_KIND[targetKind];
  if (!fields || !fields.includes(fieldName)) return v;
  return toNumberIfNumericString(v);
}

export const TARGET_KIND_TO_FIELD: Record<TargetKind, keyof ClientData | null> = {
  account: "accounts",
  income: "incomes",
  expense: "expenses",
  liability: "liabilities",
  savings_rule: "savingsRules",
  transfer: "transfers",
  reinvestment: "reinvestments",
  relocation: "relocations",
  asset_transaction: "assetTransactions",
  roth_conversion: "rothConversions",
  client_deduction: "deductions",
  withdrawal_strategy: "withdrawalStrategy",
  family_member: "familyMembers",
  external_beneficiary: "externalBeneficiaries",
  gift: "gifts",
  will: "wills",
  entity: "entities",
  // Singletons: handled specially (not a list) — see SINGLETON_KIND_TO_FIELD
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

/**
 * Singleton targetKinds — entities that live as one object on `ClientData`
 * rather than in a top-level array. `TARGET_KIND_TO_FIELD` maps these to `null`
 * alongside genuinely-nested entities, so this map exists to tell the two
 * apart. Both `applyEdit` here and the scenario changes-writer consume it.
 */
export const SINGLETON_KIND_TO_FIELD: Partial<
  Record<TargetKind, "client" | "planSettings">
> = {
  client: "client",
  plan_settings: "planSettings",
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

  // Track scenario-added entity ids per targetKind so edits referencing
  // them no-op (the add payload was already kept current).
  const addedIds: Record<TargetKind, Set<string>> = {} as Record<TargetKind, Set<string>>;

  const removed: RemovedRef[] = [];

  for (const change of sorted) {
    if (change.opType === "add") {
      applyAdd(tree, change);
      addedIds[change.targetKind] ??= new Set();
      addedIds[change.targetKind].add(change.targetId);
    } else if (change.opType === "edit") {
      const wasAdded = addedIds[change.targetKind]?.has(change.targetId) ?? false;
      if (wasAdded) continue;
      applyEdit(tree, change);
    } else if (change.opType === "remove") {
      const didRemove = applyRemove(tree, change);
      if (didRemove) {
        removed.push({
          kind: change.targetKind,
          id: change.targetId,
          causedByChangeId: change.id,
        });
      }
    }
  }

  const cascadeWarnings = resolveCascades(tree, removed);
  warnings.push(...cascadeWarnings);

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
  const entity = coerceEntityNumerics(
    change.targetKind,
    change.payload as Record<string, unknown>,
  );
  (tree[field] as unknown) = [...arr, entity];
}

function applyEdit(tree: ClientData, change: ScenarioChange): void {
  const diff = change.payload as Record<string, { from: unknown; to: unknown }>;

  const singletonField = SINGLETON_KIND_TO_FIELD[change.targetKind];
  if (singletonField != null) {
    const singleton = tree[singletonField] as unknown as Record<string, unknown>;
    for (const [k, { to }] of Object.entries(diff)) {
      singleton[k] = to;
    }
    return;
  }

  const field = TARGET_KIND_TO_FIELD[change.targetKind];
  if (field == null) {
    // Nested entity (e.g., beneficiary_designation lives on a parent) —
    // these edit paths are added in subsequent cascade-resolution tasks if needed.
    throw new Error(
      `applyScenarioChanges: cannot 'edit' for targetKind=${change.targetKind} ` +
        `(nested entity; see TARGET_KIND_TO_FIELD)`,
    );
  }

  const arr = tree[field] as unknown as Array<{ id: string }>;
  if (arr == null) return;
  const idx = arr.findIndex((e) => e.id === change.targetId);
  if (idx === -1) return;

  const target = { ...arr[idx] } as Record<string, unknown>;
  for (const [k, { to }] of Object.entries(diff)) {
    target[k] = coerceEditValue(change.targetKind, k, to);
  }
  arr[idx] = target as { id: string };
}

function applyRemove(tree: ClientData, change: ScenarioChange): boolean {
  const field = TARGET_KIND_TO_FIELD[change.targetKind];
  if (field == null) {
    throw new Error(
      `applyScenarioChanges: cannot 'remove' for targetKind=${change.targetKind} ` +
        `(not a top-level list)`,
    );
  }
  const arr = tree[field] as unknown as Array<{ id: string }> | undefined;
  if (arr == null) return false;
  const idx = arr.findIndex((e) => e.id === change.targetId);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  return true;
}
