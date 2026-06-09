// src/lib/flows-ledger/categories.ts
import type { FlowCategory } from "./types";

/** Display label per engine ledger-entry category. Exhaustive over the union:
 *  if the engine adds a category, `tsc` errors here (union-extension canary). */
export const FLOW_CATEGORY_LABEL: Record<FlowCategory, string> = {
  growth: "Growth",
  income: "Income",
  rmd: "RMD",
  expense: "Expense",
  liability: "Liability",
  tax: "Tax",
  savings_contribution: "Contribution",
  employer_match: "Employer Match",
  withdrawal: "Withdrawal",
  withdrawal_tax: "Withdrawal Tax",
  gift: "Gift",
  entity_distribution: "Entity Distribution",
  discretionary: "Discretionary",
  surplus_transfer: "Surplus Transfer",
  surplus_retained: "Surplus Retained",
};
