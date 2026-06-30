import type { TargetKind } from "@/engine/scenario/types";
import type { ChangeArea } from "../types";

export const AREA_ORDER: ChangeArea[] = [
  "Plan & Assumptions",
  "Income",
  "Expenses",
  "Savings",
  "Assets",
  "Liabilities",
  "Estate",
  "Taxes",
];

export interface KindSpec {
  area: ChangeArea;
  /** Singular, lowercase — used for fallback names + copy. */
  noun: string;
  /** "name": edit row is "<name> · <field>". "field": edit row is just "<field>". */
  whatMode: "name" | "field";
  whyAdd: string;
  whyRemove: string;
  whyEdit: string;
}

// Exhaustive: a Record<TargetKind, …> makes the compiler flag any new kind.
export const SPEC: Record<TargetKind, KindSpec> = {
  account: { area: "Assets", noun: "account", whatMode: "name",
    whyAdd: "New account added to the plan.", whyRemove: "This account is removed from the plan.", whyEdit: "Adjusts this account." },
  asset_transaction: { area: "Assets", noun: "asset transaction", whatMode: "name",
    whyAdd: "A planned buy/sell of holdings is added.", whyRemove: "This planned transaction is removed.", whyEdit: "Adjusts this planned transaction." },
  beneficiary_designation: { area: "Estate", noun: "beneficiary designation", whatMode: "name",
    whyAdd: "A beneficiary designation is added to an account.", whyRemove: "This beneficiary designation is removed.", whyEdit: "Changes who inherits this account." },
  client: { area: "Plan & Assumptions", noun: "client profile", whatMode: "field",
    whyAdd: "Client profile detail added.", whyRemove: "Client profile detail removed.", whyEdit: "Updates a core planning assumption." },
  client_deduction: { area: "Taxes", noun: "deduction", whatMode: "name",
    whyAdd: "A tax deduction is added.", whyRemove: "This deduction is removed.", whyEdit: "Adjusts this deduction." },
  entity: { area: "Estate", noun: "trust / entity", whatMode: "name",
    whyAdd: "A trust or entity is created to hold assets.", whyRemove: "This trust or entity is removed.", whyEdit: "Adjusts this trust or entity." },
  expense: { area: "Expenses", noun: "expense", whatMode: "name",
    whyAdd: "A new expense is added to the plan.", whyRemove: "This expense no longer applies.", whyEdit: "Adjusts this expense." },
  expense_schedule_override: { area: "Expenses", noun: "expense schedule", whatMode: "name",
    whyAdd: "A custom year-by-year schedule is set for this expense.", whyRemove: "The custom expense schedule is removed.", whyEdit: "Adjusts the custom expense schedule." },
  external_beneficiary: { area: "Estate", noun: "beneficiary", whatMode: "name",
    whyAdd: "An external beneficiary is added.", whyRemove: "This beneficiary is removed.", whyEdit: "Adjusts this beneficiary." },
  extra_payment: { area: "Liabilities", noun: "extra payment", whatMode: "name",
    whyAdd: "An extra loan payment is scheduled.", whyRemove: "This extra payment is removed.", whyEdit: "Adjusts this extra payment." },
  family_member: { area: "Plan & Assumptions", noun: "family member", whatMode: "name",
    whyAdd: "A family member is added to the plan.", whyRemove: "This family member is removed.", whyEdit: "Updates this family member." },
  gift: { area: "Estate", noun: "gift", whatMode: "name",
    whyAdd: "A lifetime gift is added to the plan.", whyRemove: "This gift is removed.", whyEdit: "Adjusts this gift." },
  income: { area: "Income", noun: "income source", whatMode: "name",
    whyAdd: "A new income source is added to the plan.", whyRemove: "This income source no longer applies.", whyEdit: "Adjusts this income source." },
  income_schedule_override: { area: "Income", noun: "income schedule", whatMode: "name",
    whyAdd: "A custom year-by-year schedule is set for this income.", whyRemove: "The custom income schedule is removed.", whyEdit: "Adjusts the custom income schedule." },
  liability: { area: "Liabilities", noun: "liability", whatMode: "name",
    whyAdd: "A new liability is added to the plan.", whyRemove: "This liability is removed.", whyEdit: "Adjusts this liability." },
  life_insurance_cash_value_schedule: { area: "Estate", noun: "policy cash value", whatMode: "name",
    whyAdd: "A cash-value schedule is set for this policy.", whyRemove: "The cash-value schedule is removed.", whyEdit: "Adjusts the policy cash-value schedule." },
  life_insurance_policy: { area: "Estate", noun: "life insurance policy", whatMode: "name",
    whyAdd: "A life insurance policy is added.", whyRemove: "This policy is removed.", whyEdit: "Adjusts this policy." },
  plan_settings: { area: "Plan & Assumptions", noun: "plan assumption", whatMode: "field",
    whyAdd: "A planning assumption is added.", whyRemove: "A planning assumption is removed.", whyEdit: "Updates a planning assumption." },
  reinvestment: { area: "Savings", noun: "reinvestment", whatMode: "name",
    whyAdd: "A reinvestment rule is added.", whyRemove: "This reinvestment rule is removed.", whyEdit: "Adjusts this reinvestment rule." },
  relocation: { area: "Plan & Assumptions", noun: "relocation", whatMode: "name",
    whyAdd: "A state relocation is added to the plan.", whyRemove: "This relocation is removed.", whyEdit: "Adjusts this relocation." },
  roth_conversion: { area: "Taxes", noun: "Roth conversion", whatMode: "name",
    whyAdd: "A Roth conversion is added to the plan.", whyRemove: "This Roth conversion is removed.", whyEdit: "Adjusts this Roth conversion." },
  savings_rule: { area: "Savings", noun: "savings contribution", whatMode: "name",
    whyAdd: "A savings contribution is added.", whyRemove: "This savings contribution is removed.", whyEdit: "Adjusts this savings contribution." },
  savings_schedule_override: { area: "Savings", noun: "savings schedule", whatMode: "name",
    whyAdd: "A custom year-by-year savings schedule is set.", whyRemove: "The custom savings schedule is removed.", whyEdit: "Adjusts the custom savings schedule." },
  transfer: { area: "Assets", noun: "transfer", whatMode: "name",
    whyAdd: "A transfer between accounts is added.", whyRemove: "This transfer is removed.", whyEdit: "Adjusts this transfer." },
  transfer_schedule: { area: "Assets", noun: "transfer schedule", whatMode: "name",
    whyAdd: "A custom transfer schedule is set.", whyRemove: "The custom transfer schedule is removed.", whyEdit: "Adjusts the custom transfer schedule." },
  will: { area: "Estate", noun: "will", whatMode: "name",
    whyAdd: "A will is added to the plan.", whyRemove: "This will is removed.", whyEdit: "Updates this will." },
  will_bequest: { area: "Estate", noun: "bequest", whatMode: "name",
    whyAdd: "A bequest is added to the will.", whyRemove: "This bequest is removed.", whyEdit: "Adjusts who receives this bequest, or how much." },
  will_bequest_recipient: { area: "Estate", noun: "bequest recipient", whatMode: "name",
    whyAdd: "A recipient is added to a bequest.", whyRemove: "This recipient is removed from the bequest.", whyEdit: "Adjusts this recipient's share." },
  withdrawal_strategy: { area: "Plan & Assumptions", noun: "withdrawal strategy", whatMode: "field",
    whyAdd: "A withdrawal strategy is set.", whyRemove: "The withdrawal strategy is removed.", whyEdit: "Changes the order assets are drawn down." },
};
