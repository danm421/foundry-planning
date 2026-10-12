// src/lib/fact-finder/enums.ts
/**
 * Option label ↔ app enum value. One table per option list; Plan 3's placement
 * map reads the same tables, so a label is translated in exactly one place.
 */
export type OptionMap = readonly (readonly [label: string, value: string])[];

export function labelFor(map: OptionMap, value: string | null | undefined): string | null {
  return map.find(([, v]) => v === value)?.[0] ?? null;
}

export function valueFor(map: OptionMap, label: string | null | undefined): string | null {
  return map.find(([l]) => l === label)?.[1] ?? null;
}

// accounts.sub_type, per section
export const CASH_TYPE_MAP: OptionMap = [
  ["Checking", "checking"], ["Savings", "savings"], ["CD", "cd"], ["Money market", "money_market"], ["Other", "other"],
];
export const TAXABLE_TYPE_MAP: OptionMap = [["Brokerage", "brokerage"], ["Trust", "trust"], ["Other", "other"]];
export const RETIRE_TYPE_MAP: OptionMap = [
  ["Traditional IRA", "traditional_ira"], ["Roth IRA", "roth_ira"], ["401(k)", "401k"], ["403(b)", "403b"],
  ["401(a)", "401a"], ["SEP IRA", "sep_ira"], ["SIMPLE IRA", "simple_ira"], ["HSA", "hsa"], ["Other", "other"],
];
/** An annuity's sub-type IS its tax treatment (see accountSubTypeEnum). */
export const ANNUITY_TAX_MAP: OptionMap = [
  ["Non-qualified", "non_qualified"], ["Qualified", "qualified"], ["Tax-free", "tax_free"],
];
export const PROPERTY_TYPE_MAP: OptionMap = [
  ["Primary residence", "primary_residence"], ["Rental property", "rental_property"],
  ["Commercial property", "commercial_property"],
];
/** accounts.sub_type for a business. (accounts.business_type is a different enum — Plan 3.) */
export const BUSINESS_SUBTYPE_MAP: OptionMap = [
  ["Sole proprietorship", "sole_proprietorship"], ["Partnership", "partnership"], ["S-Corp", "s_corp"],
  ["C-Corp", "c_corp"], ["LLC", "llc"], ["Other", "other"],
];
/** accounts.sub_type of a life insurance account. */
export const LIFE_SUBTYPE_MAP: OptionMap = [
  ["Term", "term"], ["Whole life", "whole_life"], ["Universal life", "universal_life"], ["Variable life", "variable_life"],
];
/** life_insurance_policies.policy_type. */
export const LIFE_POLICY_TYPE_MAP: OptionMap = [
  ["Term", "term"], ["Whole life", "whole"], ["Universal life", "universal"], ["Variable life", "variable"],
];

// people
export const OWNER_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"], ["Joint", "joint"]];
export const INCOME_OWNER_MAP: OptionMap = OWNER_MAP;
export const PERSON_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"]];
export const INSURED_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"], ["Joint (survivorship)", "joint"]];
export const GIFT_FROM_MAP: OptionMap = [["Client", "client"], ["Co-client", "spouse"], ["Joint (split gift)", "joint"]];

// income and expenses
export const INCOME_TYPE_MAP: OptionMap = [
  ["Business", "business"], ["Deferred comp", "deferred"], ["Capital gains", "capital_gains"], ["Trust", "trust"],
  ["Other", "other"],
];
export const EXPENSE_TYPE_MAP: OptionMap = [
  ["Living", "living"], ["Insurance", "insurance"], ["Education", "education"], ["Other", "other"],
];

/** The accounts.category an account section's rows become. */
export const SECTION_ACCOUNT_CATEGORY = {
  cash: "cash",
  taxable: "taxable",
  retirement: "retirement",
  annuity: "annuity",
  edu: "education_savings",
  realestate: "real_estate",
  business: "business",
} as const;
