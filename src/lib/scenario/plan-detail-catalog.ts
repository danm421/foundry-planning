// src/lib/scenario/plan-detail-catalog.ts
//
// Pure, framework-free catalog of every plan detail the Solver's Changes tab
// can add, edit or delete — the one table the Add menu, the picker's grouping
// and the editor routing all read. Each row names the Details page and the
// focus-mode kind that edits it; `detailEditorTarget` turns a row plus an
// intent into the same `{ surface: "details" }` target `resolveChangeEditor`
// returns, so the host dispatches both identically.

import type {
  CreateVariant,
  DetailsEditorPage,
  EditorFocus,
  FocusKind,
} from "./change-editor-target";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

export type DetailGroup =
  | "Cash flow"
  | "Net worth"
  | "Insurance"
  | "Estate"
  | "Techniques"
  | "Assumptions"
  | "People";

export type DetailTypeKey =
  | "income" | "social_security" | "expense" | "savings_rule"
  | "account" | "business" | "note_receivable" | "liability"
  | "life_policy" | "disability_policy"
  | "trust" | "gift" | "gift_series" | "will" | "family_member" | "external_beneficiary"
  | "roth_conversion" | "asset_transaction" | "relocation" | "transfer" | "reinvestment"
  | "deduction" | "tax_adjustment" | "tax_rates" | "growth_inflation" | "savings_withdrawals"
  | "client_info";

export interface DetailType {
  key: DetailTypeKey;
  group: DetailGroup;
  label: string;
  page: DetailsEditorPage;
  kind: FocusKind;
  add: boolean;
  edit: boolean;
  delete: boolean;
  /** Fixed create variant (business, life policy, note). */
  createVariant?: CreateVariant;
  /** Variants the advisor picks from in the Add menu (account categories, will grantor). */
  variants?: { value: CreateVariant; label: string }[];
}

export const DETAIL_GROUP_ORDER: readonly DetailGroup[] = [
  "Cash flow",
  "Net worth",
  "Insurance",
  "Estate",
  "Techniques",
  "Assumptions",
  "People",
];

// Labels match the Net Worth page's `ADDABLE_CATEGORIES` menu (its
// `CATEGORY_LABELS`), minus business and notes receivable, which are their own types.
const ACCOUNT_VARIANTS: { value: CreateVariant; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "cash", label: "Cash" },
  { value: "retirement", label: "Retirement" },
  { value: "annuity", label: "Annuity" },
  { value: "real_estate", label: "Real Estate" },
  { value: "stock_options", label: "Stock Options" },
  { value: "education_savings", label: "529 / Education" },
];

const WILL_VARIANTS: { value: CreateVariant; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "spouse", label: CO_CLIENT_LABEL },
];

type Flags = Pick<DetailType, "add" | "edit" | "delete">;
const FULL: Flags = { add: true, edit: true, delete: true };
const EDIT_ONLY: Flags = { add: false, edit: true, delete: false };

function row(
  key: DetailTypeKey,
  group: DetailGroup,
  label: string,
  page: DetailsEditorPage,
  kind: FocusKind,
  flags: Flags = FULL,
  extra: Pick<DetailType, "createVariant" | "variants"> = {},
): DetailType {
  return { key, group, label, page, kind, ...flags, ...extra };
}

export const DETAIL_TYPES: readonly DetailType[] = [
  row("income", "Cash flow", "Income", "income-expenses", "income"),
  row("social_security", "Cash flow", "Social Security", "income-expenses", "income", EDIT_ONLY),
  row("expense", "Cash flow", "Expense", "income-expenses", "expense"),
  row("savings_rule", "Cash flow", "Savings", "income-expenses", "savings_rule"),

  row("account", "Net worth", "Account", "net-worth", "account", FULL, { variants: ACCOUNT_VARIANTS }),
  row("business", "Net worth", "Business", "net-worth", "account", FULL, { createVariant: "business" }),
  row("note_receivable", "Net worth", "Note receivable", "net-worth", "note_receivable", FULL, {
    createVariant: "note_receivable",
  }),
  row("liability", "Net worth", "Debt", "net-worth", "liability"),

  row("life_policy", "Insurance", "Life insurance policy", "insurance", "account", FULL, {
    createVariant: "life_insurance",
  }),
  row("disability_policy", "Insurance", "Disability policy", "insurance", "disability_policy"),

  row("trust", "Estate", "Trust / entity", "family", "entity"),
  row("gift", "Estate", "Gift (one-time)", "family", "gift"),
  // The gift Add opens GiftDialog, which picks one-time vs recurring inside.
  row("gift_series", "Estate", "Recurring gift", "family", "gift", { add: false, edit: true, delete: true }),
  row("will", "Estate", "Will", "wills", "will", FULL, { variants: WILL_VARIANTS }),
  row("family_member", "Estate", "Family member", "family", "family_member"),
  row("external_beneficiary", "Estate", "Charity / outside beneficiary", "family", "external_beneficiary"),

  row("roth_conversion", "Techniques", "Roth conversion", "techniques", "roth_conversion"),
  row("asset_transaction", "Techniques", "Buy / sell", "techniques", "asset_transaction"),
  row("relocation", "Techniques", "Relocation", "techniques", "relocation"),
  row("transfer", "Techniques", "Transfer", "techniques", "transfer"),
  row("reinvestment", "Techniques", "Reinvestment", "techniques", "reinvestment"),

  row("deduction", "Assumptions", "Deduction", "assumptions", "client_deduction"),
  row("tax_adjustment", "Assumptions", "Tax adjustment", "assumptions", "client_tax_adjustment"),
  row("tax_rates", "Assumptions", "Tax rates", "assumptions", "plan_settings", EDIT_ONLY),
  row("growth_inflation", "Assumptions", "Growth & inflation", "assumptions", "plan_settings", EDIT_ONLY),
  row("savings_withdrawals", "Assumptions", "Savings & withdrawals", "assumptions", "plan_settings", EDIT_ONLY),

  row("client_info", "People", "Client info", "family", "client", EDIT_ONLY),
];

// Types whose Details editor still has an open workstream: the Add menu and the
// picker show them greyed ("Coming in this release") and they open nothing.
// Each workstream's task deletes its keys here; the last one leaves it empty.
export const NOT_YET_READY: ReadonlySet<DetailTypeKey> = new Set<DetailTypeKey>([
  "business", "note_receivable",
  "life_policy", "disability_policy",
  "gift_series", "family_member", "external_beneficiary", "reinvestment",
  "deduction", "tax_adjustment",
  "tax_rates", "growth_inflation", "savings_withdrawals",
]);

// The three Assumptions singletons always focus their own tab, whatever id the caller passes.
export const SINGLETON_FOCUS_ID: Partial<Record<DetailTypeKey, string>> = {
  tax_rates: "tax-rates",
  growth_inflation: "growth-inflation",
  savings_withdrawals: "withdrawal",
};

export function detailType(key: DetailTypeKey): DetailType {
  const t = DETAIL_TYPES.find((d) => d.key === key);
  if (!t) throw new Error(`Unknown plan detail type: ${key}`);
  return t;
}

export function detailEditorTarget(
  key: DetailTypeKey,
  action: { intent: "create"; variant?: CreateVariant } | { intent: "edit" | "delete"; id: string },
): { surface: "details"; page: DetailsEditorPage; focus: EditorFocus } {
  const t = detailType(key);
  let focus: EditorFocus;
  if (action.intent === "create") {
    const variant = action.variant ?? t.createVariant;
    focus = variant
      ? { intent: "create", kind: t.kind, variant }
      : { intent: "create", kind: t.kind };
  } else {
    const id = SINGLETON_FOCUS_ID[key] ?? action.id;
    focus = { intent: action.intent, kind: t.kind, id };
  }
  return { surface: "details", page: t.page, focus };
}
