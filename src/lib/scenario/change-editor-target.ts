// src/lib/scenario/change-editor-target.ts
//
// Pure, framework-free resolver: given a scenario change, decides WHERE that
// change is edited — which Details page (and which entity within it) or a
// Solver tab: Stress for a plan_settings stress-test override, Retirement for
// the plan horizon and the client's retirement / life-expectancy fields — or
// "unsupported" when the kind's Details editor is known to corrupt data inside
// a scenario (Ruling F-I2).
// Returns null when the change has nothing to open: it's a `remove`, it's
// disabled, or its targetKind is a child row that is never written as its
// own change (it lives nested under a parent entity's payload instead).
//
// See the plan's Architecture section (Task 3 table) for the full
// targetKind → page mapping, controller ruling T3-a for why the resolver never
// looks past targetKind otherwise, and T4d-horizon (which superseded P3) for
// the Retirement-tab branches.

import type { OpType, TargetKind } from "@/engine/scenario/types";

export type DetailsEditorPage =
  | "income-expenses"
  | "net-worth"
  | "techniques"
  | "family"
  | "wills";

export interface EditorFocus {
  kind: TargetKind;
  id: string;
  field?: string;
}

export type ChangeEditorTarget =
  | { surface: "details"; page: DetailsEditorPage; focus: EditorFocus }
  | { surface: "solver-tab"; tab: "stress_test" | "retirement" }
  | { surface: "unsupported" }
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
// that are never written as their own change row, `plan_settings`, which is
// resolved separately below, and the Assumptions kinds, whose page has no
// per-row editor to open (Ruling T4e-assumptions).
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
};

// Ruling F-I2: kinds whose Details editor is KNOWN to corrupt data inside a
// scenario — it writes the base plan, or it opens on base values so a save
// reverts the scenario's own change. The Solver explains instead of opening
// (or linking to) that editor. Delete an entry once its Details-page bug is
// fixed (vault `future-work/scenarios.md`).
//   reinvestment — its form backfills from the base-only reinvestments GET
//     (T4c-reinvestment).
//   family_member — the page lists members from the base table (T4d-member).
//   external_beneficiary — its inline form PATCHes the base row (T4d-extben).
//   client_deduction / client_tax_adjustment / withdrawal_strategy — the page
//     lists base-case rows whatever the scenario (T4e-assumptions).
const UNSUPPORTED_KINDS: ReadonlySet<TargetKind> = new Set<TargetKind>([
  "reinvestment",
  "family_member",
  "external_beneficiary",
  "client_deduction",
  "client_tax_adjustment",
  "withdrawal_strategy",
]);

/** An `entity` edit is unsupported too (Ruling F-I3): every trust-dialog tab
 *  saves the edit's payload as that tab's diff alone, wiping the rest. An
 *  entity `add` is safe — the writer merges saves into the add payload. */
function isUnsupported({ targetKind, opType }: ChangeEditorInput): boolean {
  return UNSUPPORTED_KINDS.has(targetKind) || (targetKind === "entity" && opType === "edit");
}

// Ruling T4d-horizon: the Solver's Retirement tab (`SolverRowRetirementAges` /
// `SolverRowLifeExpectancy` in live-solver-workspace.tsx, tab id "retirement")
// owns the plan horizon. Its life-expectancy save writes the pair together —
// `client.planEndAge` plus `plan_settings.planEndYear` — while the Family
// page's `AddClientDialog`, in scenario mode, writes neither, so a horizon or
// retirement change opened there could not be edited faithfully. These are
// exactly the `client` fields `mutationsToScenarioChanges` writes for its
// retirement-age and life-expectancy mutations (plus the derived planEndAge).
const RETIREMENT_TAB_CLIENT_FIELDS = new Set([
  "retirementAge",
  "retirementMonth",
  "spouseRetirementAge",
  "spouseRetirementMonth",
  "lifeExpectancy",
  "spouseLifeExpectancy",
  "planEndAge",
]);

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

export function resolveChangeEditor(change: ChangeEditorInput): ChangeEditorTarget {
  if (change.opType === "remove" || !change.enabled) return null;

  if (isUnsupported(change)) return { surface: "unsupported" };

  if (change.targetKind === "plan_settings") {
    return resolvePlanSettingsTarget(change.payload);
  }

  if (change.targetKind === "client") {
    const fields = payloadFields(change.payload);
    if (fields && fields.length > 0 && fields.every((f) => RETIREMENT_TAB_CLIENT_FIELDS.has(f))) {
      return { surface: "solver-tab", tab: "retirement" };
    }
  }

  const page = DETAILS_PAGE_BY_KIND[change.targetKind];
  if (!page) return null;

  return {
    surface: "details",
    page,
    focus: { kind: change.targetKind, id: change.targetId },
  };
}

/** The changed field names of an edit payload, or null when it isn't an object. */
function payloadFields(payload: unknown): string[] | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  return Object.keys(payload as Record<string, unknown>);
}

// Ruling T4d-horizon: a payload containing planEndYear -> the Retirement tab,
// ahead of the stress check. Otherwise ANY stress field -> the Stress tab
// (Ruling F-M2: the Solver folds every plan_settings edit into one row per
// scenario, so a stress lever often shares it with other settings); anything
// else (no stress field, empty, or non-object) -> null.
function resolvePlanSettingsTarget(payload: unknown): ChangeEditorTarget {
  const fields = payloadFields(payload);
  if (!fields || fields.length === 0) return null;

  if (fields.includes("planEndYear")) {
    return { surface: "solver-tab", tab: "retirement" };
  }

  if (fields.some((field) => STRESS_FIELDS.has(field))) {
    return { surface: "solver-tab", tab: "stress_test" };
  }

  return null;
}
