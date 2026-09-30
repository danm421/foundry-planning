// src/lib/scenario/change-editor-target.ts
//
// Pure, framework-free resolver: given a scenario change, decides WHERE that
// change is edited — which Details page (and which entity within it) or,
// for a plan_settings stress-test override, the Solver's Stress tab.
// Returns null when the change has nothing to open: it's a `remove`, it's
// disabled, or its targetKind is a child row that is never written as its
// own change (it lives nested under a parent entity's payload instead).
//
// See the plan's Architecture section (Task 3 table) for the full
// targetKind → page mapping, and controller rulings P3 / T3-a for the
// plan_settings branch and why the resolver never looks past targetKind.

import type { OpType, TargetKind } from "@/engine/scenario/types";

export type DetailsEditorPage =
  | "income-expenses"
  | "net-worth"
  | "techniques"
  | "family"
  | "wills"
  | "assumptions";

export interface EditorFocus {
  kind: TargetKind;
  id: string;
  field?: string;
}

export type ChangeEditorTarget =
  | { surface: "details"; page: DetailsEditorPage; focus: EditorFocus }
  | { surface: "solver-tab"; tab: "stress_test" }
  | null;

/**
 * Structural shape of a scenario change, typed inline so this module (under
 * `src/lib/`) never imports the Solver panel's `ChangesPanelChange` (under
 * `src/components/`). `ScenarioChange` (engine) plus the panel's `enabled`
 * flag is exactly what the resolver needs.
 */
export interface ChangeEditorInput {
  opType: OpType;
  targetKind: TargetKind;
  targetId: string;
  payload: unknown;
  enabled: boolean;
}

// Direct targetKind → Details page mapping. T3-a: the resolver never
// distinguishes Social Security income from other income, a top-level
// business account from other accounts, or bundled asset transactions — the
// Details view picks the right dialog from the row it already holds.
//
// Kinds absent here are child rows (*_schedule_override, extra_payment,
// will_bequest*, beneficiary_designation, life_insurance_*, transfer_schedule)
// that are never written as their own change row, plus `plan_settings`,
// which is resolved separately below.
const DETAILS_PAGE_BY_KIND: Partial<Record<TargetKind, DetailsEditorPage>> = {
  income: "income-expenses",
  expense: "income-expenses",
  savings_rule: "income-expenses",
  account: "net-worth",
  liability: "net-worth",
  roth_conversion: "techniques",
  reinvestment: "techniques",
  relocation: "techniques",
  asset_transaction: "techniques",
  transfer: "techniques",
  client: "family",
  family_member: "family",
  entity: "family",
  gift: "family",
  external_beneficiary: "family",
  will: "wills",
  client_deduction: "assumptions",
  client_tax_adjustment: "assumptions",
  withdrawal_strategy: "assumptions",
};

// plan_settings fields that toggle the Solver's Stress tab — mirrors the
// stress-* mutations in src/lib/solver/mutations-to-scenario-changes.ts.
const STRESS_FIELDS = new Set([
  "livingExpenseInflationOverride",
  "ssBenefitHaircut",
  "disabilityEvent",
  "marketShock",
  "lifetimeExemptionCap",
  "taxRateStress",
]);

export function resolveChangeEditor(
  change: ChangeEditorInput,
  clientId: string,
): ChangeEditorTarget {
  if (change.opType === "remove" || !change.enabled) return null;

  if (change.targetKind === "plan_settings") {
    return resolvePlanSettingsTarget(change.payload, clientId);
  }

  const page = DETAILS_PAGE_BY_KIND[change.targetKind];
  if (!page) return null;

  return {
    surface: "details",
    page,
    focus: { kind: change.targetKind, id: change.targetId },
  };
}

// Ruling P3: a payload containing planEndYear resolves to family/client
// using the passed-in clientId (plan_settings is a singleton row, so
// targetId isn't the client's id). Otherwise: every field a stress field ->
// the Stress tab; anything else (mixed, empty, or non-object) -> null.
function resolvePlanSettingsTarget(
  payload: unknown,
  clientId: string,
): ChangeEditorTarget {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const fields = Object.keys(payload as Record<string, unknown>);
  if (fields.length === 0) return null;

  if (fields.includes("planEndYear")) {
    return {
      surface: "details",
      page: "family",
      focus: { kind: "client", id: clientId },
    };
  }

  if (fields.every((field) => STRESS_FIELDS.has(field))) {
    return { surface: "solver-tab", tab: "stress_test" };
  }

  return null;
}
