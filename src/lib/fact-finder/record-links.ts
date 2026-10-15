// src/lib/fact-finder/record-links.ts
// Where a saved record can be seen: the Details page that shows its target.
// None of those pages scrolls to one record, so the link is to the page (the
// Tax Rates tab for the tax settings). Client-safe, no imports beyond types;
// record-links.test.ts pins every target against the Details field map.
import type { TargetKind } from "./change-set";

type Page = "family" | "net-worth" | "income-expenses" | "insurance" | "wills" | "observations" | "assumptions?tab=tax-rates";

const PAGE_OF: Readonly<Record<TargetKind, Page>> = {
  client_household: "family",
  plan_settings_tax_rates: "assumptions?tab=tax-rates",
  family_member: "family",
  external_beneficiary: "family",
  related_party: "family",
  entity: "family",
  revocable_trust: "family",
  trust_beneficiary_designation: "family",
  gift: "family",
  account: "net-worth",
  business_account: "net-worth",
  account_beneficiary_designation: "net-worth",
  annuity_contract: "net-worth",
  stock_option_account: "net-worth",
  stock_option_grant: "net-worth",
  note_receivable: "net-worth",
  liability: "net-worth",
  income: "income-expenses",
  expense: "income-expenses",
  savings_rule: "income-expenses",
  life_insurance_policy: "insurance",
  life_insurance_policy_beneficiary: "insurance",
  disability_policy: "insurance",
  ltc_policy: "insurance",
  will: "wills",
  will_bequest: "wills",
  will_residuary_recipient: "wills",
  plan_observation: "observations",
};

/** The Details page that shows `target`'s records. */
export function detailsHrefFor(clientId: string, target: TargetKind): string {
  return `/clients/${clientId}/details/${PAGE_OF[target]}`;
}
