// src/lib/scenario/change-editor-target.ts
//
// Pure, framework-free resolver: given a scenario change, decides WHERE that
// change is edited — which Details page (and which entity within it) or a
// Solver tab: Stress for a plan_settings stress-test override, Retirement for
// the plan horizon and the client's retirement / life-expectancy fields.
// Returns null when the change has nothing to open: it's a `remove`, it's
// disabled, or its targetKind is a child row that is never written as its
// own change (it lives nested under a parent entity's payload instead).
//
// See the plan's Architecture section (Task 3 table) for the full
// targetKind → page mapping, controller ruling T3-a for why the resolver never
// looks past targetKind otherwise, and T4d-horizon (which superseded P3) for
// the Retirement-tab branches.

import type { OpType, TargetKind } from "@/engine/scenario/types";
import type { LtcEvent } from "@/engine/types";
import { CLIENT_SINGLETON_FORM_KEYS } from "@/lib/scenario/plan-settings-fields";
import { GROWTH_SETTINGS_KEYS } from "@/lib/scenario/growth-settings-override";

export type DetailsEditorPage =
  | "income-expenses"
  | "net-worth"
  | "techniques"
  | "family"
  | "wills"
  | "insurance"
  | "assumptions";

/** A focus kind: a scenario TargetKind, or a partitioned table's pseudo-kind. */
export type FocusKind = TargetKind | "note_receivable";

export type CreateVariant =
  | "taxable"
  | "cash"
  | "retirement"
  | "annuity"
  | "real_estate"
  | "stock_options"
  | "education_savings"
  | "business"
  | "note_receivable"
  | "life_insurance"
  | "client"
  | "spouse";

// Assumptions singletons use `kind: "plan_settings"` with `id` set to the
// Assumptions tab id ("tax-rates" | "growth-inflation" | "withdrawal").
export interface EditFocus {
  intent?: "edit";
  kind: FocusKind;
  id: string;
  field?: string;
}
export interface DeleteFocus {
  intent: "delete";
  kind: FocusKind;
  id: string;
}
export interface CreateFocus {
  intent: "create";
  kind: FocusKind;
  variant?: CreateVariant;
}
export type EditorFocus = EditFocus | DeleteFocus | CreateFocus;

/**
 * Per Details page, the focus kinds its views' `findFocusRow` open a dialog for.
 * `note_receivable` is on no page: nothing opens it this release (it is
 * `NOT_YET_READY`). Each view's focus test pins its own entry.
 */
export const PAGE_FOCUS_KINDS: Record<DetailsEditorPage, readonly FocusKind[]> = {
  "income-expenses": ["income", "expense", "savings_rule"],
  "net-worth": ["account", "liability"],
  techniques: ["roth_conversion", "transfer", "reinvestment", "relocation", "asset_transaction"],
  family: ["client", "family_member", "entity", "gift", "external_beneficiary"],
  wills: ["will"],
  insurance: ["account", "disability_policy"],
  assumptions: ["plan_settings", "client_deduction", "client_tax_adjustment", "withdrawal_strategy"],
};

/** The row id a focus names, or null for a create. */
export function focusRowId(focus: EditorFocus): string | null {
  return focus.intent === "create" ? null : focus.id;
}

/** True for a focus that edits (intent absent or "edit"). */
export function isEditFocus(focus: EditorFocus): focus is EditFocus {
  return focus.intent === undefined || focus.intent === "edit";
}

export type ChangeEditorTarget =
  | { surface: "details"; page: DetailsEditorPage; focus: EditorFocus }
  | { surface: "solver-tab"; tab: "stress_test" | "retirement" }
  | { surface: "ltc-event"; changeId: string; event: LtcEvent }
  | null;

/**
 * Structural shape of a scenario change, typed inline so this module (under
 * `src/lib/`) never imports the Solver panel's `ChangesPanelChange` (under
 * `src/components/`). `ScenarioChange` (engine) plus the panel's `enabled`
 * flag is exactly what the resolver needs.
 */
export interface ChangeEditorInput {
  /** The change row's id; only the LTC dialog needs it. */
  id?: string;
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
// that are never written as their own change row, and `plan_settings`, which
// is resolved separately below.
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
  disability_policy: "insurance",
  client_deduction: "assumptions",
  client_tax_adjustment: "assumptions",
  withdrawal_strategy: "assumptions",
};

// Ruling T4d-horizon: the Solver's Retirement tab (`SolverRowRetirementAges` /
// `SolverRowLifeExpectancy` in live-solver-workspace.tsx, tab id "retirement")
// owns the plan horizon. Its life-expectancy save writes the pair together —
// `client.planEndAge` plus `plan_settings.planEndYear` — while the Family
// page's `AddClientDialog`, in scenario mode, writes neither, so a horizon or
// retirement change opened there could not be edited faithfully. These are
// exactly the `client` fields `mutationsToScenarioChanges` writes for its
// retirement-age and life-expectancy mutations (plus the derived planEndAge).
// The `client` fields `TaxRatesForm` writes (CLIENT_SINGLETON_FORM_KEYS); the
// Family page's client dialog has no control for them.
const TAX_RATES_CLIENT_FIELDS = new Set<string>(CLIENT_SINGLETON_FORM_KEYS);

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

  if (change.targetKind === "ltc_event") {
    // No Details page exists for a scenario-only stress event; the Solver
    // hosts its own dialog (spec Phase 1, "Opening the editor").
    return change.id
      ? { surface: "ltc-event", changeId: change.id, event: change.payload as LtcEvent }
      : null;
  }

  if (change.targetKind === "plan_settings") {
    return resolvePlanSettingsTarget(change.payload);
  }

  if (change.targetKind === "client") {
    const fields = payloadFields(change.payload);
    if (fields && fields.length > 0 && fields.every((f) => RETIREMENT_TAB_CLIENT_FIELDS.has(f))) {
      return { surface: "solver-tab", tab: "retirement" };
    }
    if (fields && fields.length > 0 && fields.every((f) => TAX_RATES_CLIENT_FIELDS.has(f))) {
      return {
        surface: "details",
        page: "assumptions",
        focus: { kind: "plan_settings", id: "tax-rates" },
      };
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

// The settings `SurplusCashFlowForm` saves; they live on the Assumptions page's
// "Savings & Withdrawals" tab, whose focus id is "withdrawal".
const SURPLUS_FIELDS = new Set([
  "surplusSpendPct",
  "surplusSaveAccountId",
  "surplusSpendAllUntilRetirement",
]);
const GROWTH_FIELDS: ReadonlySet<string> = new Set(GROWTH_SETTINGS_KEYS);

// Ruling T4d-horizon: a payload containing planEndYear -> the Retirement tab,
// ahead of the stress check. Otherwise ANY stress field -> the Stress tab
// (Ruling F-M2: the Solver folds every plan_settings edit into one row per
// scenario, so a stress lever often shares it with other settings). What is
// left opens on the Assumptions page, on a tab chosen by priority: any growth
// key -> "growth-inflation", else any surplus key -> "withdrawal", else
// "tax-rates". An empty or non-object payload
// has nothing to open (null).
function resolvePlanSettingsTarget(payload: unknown): ChangeEditorTarget {
  const fields = payloadFields(payload);
  if (!fields || fields.length === 0) return null;

  if (fields.includes("planEndYear")) {
    return { surface: "solver-tab", tab: "retirement" };
  }

  if (fields.some((field) => STRESS_FIELDS.has(field))) {
    return { surface: "solver-tab", tab: "stress_test" };
  }

  const id = fields.some((f) => GROWTH_FIELDS.has(f))
    ? "growth-inflation"
    : fields.some((f) => SURPLUS_FIELDS.has(f))
      ? "withdrawal"
      : "tax-rates";
  return { surface: "details", page: "assumptions", focus: { kind: "plan_settings", id } };
}
