/**
 * Human labels for `audit_log.resource_type` values, used by the activity
 * entity filter. The filter's options are derived from the resource types that
 * actually appear in a client's history (see `listActivityResourceTypes`), so
 * this map only needs to make them readable — anything not listed falls back to
 * a title-cased version of the raw type.
 */
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  account: "Accounts",
  account_group: "Account groups",
  account_flow_overrides: "Account cash-flow overrides",
  liability: "Liabilities",
  income: "Income",
  expense: "Expenses",
  asset_transaction: "Asset transactions",
  extra_payment: "Extra payments",
  transfer: "Transfers",
  savings_rule: "Savings rules",
  roth_conversion: "Roth conversions",
  client: "Client details",
  family_member: "Family members",
  entity: "Entities",
  entity_owners: "Entity owners",
  entity_flow_overrides: "Entity cash-flow overrides",
  revocable_trust: "Revocable trusts",
  trust_split_interest: "Split-interest trusts",
  note_receivable: "Notes receivable",
  gift: "Gifts",
  gift_series: "Gift series",
  will: "Wills",
  insurance_policy: "Insurance policies",
  life_insurance_solver_settings: "Life-insurance solver",
  medicare_coverage: "Medicare coverage",
  stock_option_account: "Stock option accounts",
  stock_option_grant: "Stock option grants",
  plan_settings: "Plan settings",
  scenario: "Scenarios",
  scenario_change: "Scenario changes",
  toggle_group: "Scenario toggle groups",
  client_comparison: "Comparisons",
  comparison_layout: "Comparison layouts",
  report: "Reports",
  intake_form: "Intake forms",
  client_import: "Imports",
  client_import_file: "Import files",
  crm_document: "Documents",
  forge_conversation: "Forge conversations",
  portal_invite: "Portal invites",
  open_item: "Open items",
};

export function resourceTypeLabel(resourceType: string): string {
  const known = RESOURCE_TYPE_LABELS[resourceType];
  if (known) return known;
  return resourceType
    .split(/[._]/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
