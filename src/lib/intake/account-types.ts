/**
 * The account taxonomy the client intake form offers.
 *
 * Same shape the advisor's own form uses (`add-account-form.tsx`): a core
 * category, then the sub-type inside it — Retirement → Roth IRA. Every value
 * below is a member of the DB's `account_category` / `account_sub_type` enums,
 * so an intake account lands as exactly the row an advisor would have typed
 * rather than the flat "category, sub_type = other" the form used to write.
 *
 * Trimmed to what a client can answer unaided:
 *   - real estate and business are collected on the Property step
 *   - notes receivable and stock options need grant-level detail this form
 *     doesn't ask for, so they stay advisor-only
 *
 * The name is DERIVED from this taxonomy (see `deriveIntakeAccountName`), so
 * the form never asks a client to invent one.
 */

import { individualOwnerLabel } from "@/lib/owner-labels";

// Tuple literals — zod builds its enums from these, so they have to stay
// tuples rather than being mapped out of the grouped list below.
export const INTAKE_ACCOUNT_CATEGORY_VALUES = [
  "taxable",
  "cash",
  "retirement",
  "education_savings",
  "annuity",
  "life_insurance",
] as const;

export const INTAKE_ACCOUNT_SUB_TYPE_VALUES = [
  "brokerage",
  "trust",
  "checking",
  "savings",
  "money_market",
  "cd",
  "traditional_ira",
  "roth_ira",
  "401k",
  "403b",
  "401a",
  "sep_ira",
  "simple_ira",
  "hsa",
  "529",
  "term",
  "whole_life",
  "universal_life",
  "variable_life",
  "other",
  // Annuity tax treatments. In the tuple so the zod enum and the DB column
  // agree, but deliberately NOT offered on the form — see the annuity group
  // below and `intakeFallbackSubType`.
  "qualified",
  "non_qualified",
  "tax_free",
] as const;

export type IntakeAccountCategory = (typeof INTAKE_ACCOUNT_CATEGORY_VALUES)[number];
export type IntakeAccountSubType = (typeof INTAKE_ACCOUNT_SUB_TYPE_VALUES)[number];

export interface IntakeAccountTypeGroup {
  value: IntakeAccountCategory;
  label: string;
  /**
   * Offered sub-types, in display order. An empty list (annuity) means the
   * category has no meaningful split — the form hides the picker and apply
   * writes the column's "other" default. A single entry (529) is assigned
   * silently for the same reason: a one-option select is noise.
   */
  subTypes: { value: IntakeAccountSubType; label: string }[];
}

export const INTAKE_ACCOUNT_TYPES: IntakeAccountTypeGroup[] = [
  {
    value: "taxable",
    label: "Taxable investments",
    subTypes: [
      { value: "brokerage", label: "Brokerage" },
      { value: "trust", label: "Trust account" },
      { value: "other", label: "Other investment account" },
    ],
  },
  {
    value: "cash",
    label: "Cash & savings",
    subTypes: [
      { value: "checking", label: "Checking" },
      { value: "savings", label: "Savings" },
      { value: "money_market", label: "Money market" },
      { value: "cd", label: "CD" },
      { value: "other", label: "Other cash account" },
    ],
  },
  {
    value: "retirement",
    label: "Retirement",
    subTypes: [
      { value: "traditional_ira", label: "Traditional IRA" },
      { value: "roth_ira", label: "Roth IRA" },
      { value: "401k", label: "401(k)" },
      { value: "403b", label: "403(b)" },
      { value: "401a", label: "401(a)" },
      { value: "sep_ira", label: "SEP IRA" },
      { value: "simple_ira", label: "SIMPLE IRA" },
      { value: "hsa", label: "HSA" },
      { value: "other", label: "Other retirement account" },
    ],
  },
  {
    value: "education_savings",
    label: "Education savings",
    subTypes: [{ value: "529", label: "529 Plan" }],
  },
  {
    // Empty on purpose. An annuity's sub-type IS its tax treatment — qualified,
    // non-qualified or tax-free — and that is not something a household can
    // answer unaided, which is the line this taxonomy is trimmed to. The
    // advisor sets it on the account's own Type dropdown; intake lands the
    // account on `intakeFallbackSubType`'s default.
    value: "annuity",
    label: "Annuity",
    subTypes: [],
  },
  {
    value: "life_insurance",
    label: "Life insurance",
    subTypes: [
      { value: "term", label: "Term Life" },
      { value: "whole_life", label: "Whole Life" },
      { value: "universal_life", label: "Universal Life" },
      { value: "variable_life", label: "Variable Life" },
    ],
  },
];

/** Category picker options — the top-level select in the Accounts step. */
export const INTAKE_ACCOUNT_CATEGORY_OPTIONS: {
  value: IntakeAccountCategory;
  label: string;
}[] = INTAKE_ACCOUNT_TYPES.map(({ value, label }) => ({ value, label }));

/** "taxable" is a blank account's category, so it's the fallback everywhere. */
export const DEFAULT_INTAKE_ACCOUNT_CATEGORY: IntakeAccountCategory = "taxable";

function groupFor(category: IntakeAccountCategory | undefined): IntakeAccountTypeGroup {
  return (
    INTAKE_ACCOUNT_TYPES.find((g) => g.value === (category ?? DEFAULT_INTAKE_ACCOUNT_CATEGORY)) ??
    INTAKE_ACCOUNT_TYPES[0]
  );
}

/** Sub-types on offer for a category; empty when the category has no split. */
export function subTypesForCategory(
  category: IntakeAccountCategory | undefined,
): { value: IntakeAccountSubType; label: string }[] {
  return groupFor(category).subTypes;
}

/**
 * The sub-type a freshly picked category starts on: its first option, or
 * undefined when the category offers none (apply falls back to "other").
 */
export function defaultSubTypeForCategory(
  category: IntakeAccountCategory | undefined,
): IntakeAccountSubType | undefined {
  return groupFor(category).subTypes[0]?.value;
}

/**
 * The sub-type an intake account lands on when the form asked for none.
 *
 * Annuities never take 'other': the advisor's Account Type dropdown offers
 * only the three tax treatments, so an annuity left on 'other' would open with
 * a Type select showing no matching option. `non_qualified` is the same
 * default `annuity_contracts.tax_treatment` carries, and the advisor corrects
 * it on the account.
 */
export function intakeFallbackSubType(
  category: IntakeAccountCategory | undefined,
): IntakeAccountSubType {
  return category === "annuity" ? "non_qualified" : "other";
}

/** True when `subType` is one this category actually offers. */
export function isSubTypeOfCategory(
  category: IntakeAccountCategory | undefined,
  subType: string | undefined,
): boolean {
  return subTypesForCategory(category).some((s) => s.value === subType);
}

export interface IntakeAccountShape {
  category?: IntakeAccountCategory;
  subType?: IntakeAccountSubType;
  owner?: "client" | "spouse" | "joint";
  custodian?: string;
}

/**
 * What the account IS, at the finest grain the client told us: the sub-type
 * label where there is one ("Roth IRA"), the category label otherwise
 * ("Annuity"). Used for the derived name, the collapsed row, the CRM note, and
 * the advisor's review diff, so all four agree.
 */
export function intakeAccountTypeLabel(account: IntakeAccountShape): string {
  const group = groupFor(account.category);
  return (
    group.subTypes.find((s) => s.value === account.subType)?.label ?? group.label
  );
}

/** Owner names for the derived account name; blanks fall back to the roles. */
export interface IntakeOwnerNames {
  clientName?: string;
  spouseName?: string;
}

// Wording for the enum itself lives in `owner-labels`; all this adds is the
// form's own blank-handling — the client may not have named themselves yet.
function ownerLabel(
  owner: IntakeAccountShape["owner"],
  { clientName, spouseName }: IntakeOwnerNames,
): string {
  return individualOwnerLabel(owner ?? "client", {
    clientName: clientName?.trim() || "Client",
    spouseName: spouseName?.trim() || null,
  });
}

/** `intakeAccountSchema.name` caps at 120; a long custodian must not blow it. */
const NAME_MAX = 120;

/**
 * Type · owner · custodian, e.g. "Roth IRA - Dana - Fidelity". The form derives
 * this on every edit instead of asking for a name, so an intake account arrives
 * self-describing rather than as whatever the client typed ("mine", "acct 2").
 * Custodian is dropped when blank — it's optional on the form.
 */
export function deriveIntakeAccountName(
  account: IntakeAccountShape,
  names: IntakeOwnerNames = {},
): string {
  return [
    intakeAccountTypeLabel(account),
    ownerLabel(account.owner, names),
    account.custodian?.trim() || null,
  ]
    .filter(Boolean)
    .join(" - ")
    .slice(0, NAME_MAX);
}
