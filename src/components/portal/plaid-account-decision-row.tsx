"use client";

import { mapPlaidToFoundry, mapPlaidToLiability } from "@/lib/plaid/account-mapping";

export type PlaidAvailableAccount = {
  plaidAccountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance: number | null;
};

export type RowState = {
  // "create" = add as a new account/debt; "link" = link to an existing one.
  mode: "create" | "link";
  // Encodes the chosen Foundry type for "create": `asset|<category>|<subType>`
  // or `debt|<liabilityType>`. Defaulted to the Plaid-detected type.
  typeKey: string;
  // Target id when mode === "link" (an account id, or a liability id for debts).
  existingId: string | null;
  // True when the row is dismissed (X) — excluded from import, restorable.
  skipped: boolean;
};

export type LinkCandidate = { id: string; name: string; category: string; subType: string };
export type LiabilityCandidate = {
  id: string;
  name: string;
  liabilityType: string | null;
  balance: string;
};

// Decision shape posted to /exchange/commit. The client picks the Foundry type
// for "create" decisions; the route re-validates each enum before writing.
export type Decision =
  | { plaidAccountId: string; action: "skip" }
  | { plaidAccountId: string; action: "link"; existingAccountId: string }
  | { plaidAccountId: string; action: "link-liability"; existingLiabilityId: string }
  | {
      plaidAccountId: string;
      action: "create";
      kind: "asset";
      name: string;
      mask: string | null;
      balance: number | null;
      category: string;
      subType: string;
    }
  | {
      plaidAccountId: string;
      action: "create";
      kind: "debt";
      name: string;
      mask: string | null;
      balance: number | null;
      liabilityType: string;
    };

/** Plaid type → the type-key we pre-select in the "Add as new" dropdown. */
export function defaultTypeKey(type: string, subtype: string | null): string {
  const liab = mapPlaidToLiability(type, subtype);
  if (liab) return `debt|${liab.liabilityType}`;
  const asset = mapPlaidToFoundry(type, subtype);
  if (asset) return `asset|${asset.category}|${asset.subType}`;
  return "asset|cash|other";
}

export function buildDecision(account: PlaidAvailableAccount, state: RowState): Decision {
  if (state.skipped) return { plaidAccountId: account.plaidAccountId, action: "skip" };
  const isDebt = state.typeKey.startsWith("debt|");
  if (state.mode === "link") {
    return isDebt
      ? { plaidAccountId: account.plaidAccountId, action: "link-liability", existingLiabilityId: state.existingId! }
      : { plaidAccountId: account.plaidAccountId, action: "link", existingAccountId: state.existingId! };
  }
  if (isDebt) {
    const liabilityType = state.typeKey.split("|")[1];
    return {
      plaidAccountId: account.plaidAccountId, action: "create", kind: "debt",
      name: account.name, mask: account.mask, balance: account.balance, liabilityType,
    };
  }
  const [, category, subType] = state.typeKey.split("|");
  return {
    plaidAccountId: account.plaidAccountId, action: "create", kind: "asset",
    name: account.name, mask: account.mask, balance: account.balance, category, subType,
  };
}

// ── Foundry account-type catalog ──────────────────────────────────────────
// Mirrors the schema enums (accountCategoryEnum / accountSubTypeEnum /
// liabilityTypeEnum). Kept here so the row offers the full type list without
// pulling the server account-mapping into the client beyond the pure helpers.

const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real estate",
  business: "Business",
  stock_options: "Stock options",
  life_insurance: "Life insurance",
  notes_receivable: "Notes receivable",
};

const SUBTYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  hsa: "HSA",
  cd: "CD",
  money_market: "Money market",
  brokerage: "Brokerage",
  "529": "529",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  "403b": "403(b)",
  sep_ira: "SEP IRA",
  simple_ira: "SIMPLE IRA",
  "401a": "401(a)",
  primary_residence: "Primary residence",
  rental_property: "Rental property",
  commercial_property: "Commercial property",
  sole_proprietorship: "Sole proprietorship",
  partnership: "Partnership",
  s_corp: "S-corp",
  c_corp: "C-corp",
  llc: "LLC",
  term: "Term",
  whole_life: "Whole life",
  universal_life: "Universal life",
  variable_life: "Variable life",
  other: "Other",
};

const ASSET_GROUPS: { category: string; subTypes: string[] }[] = [
  { category: "cash", subTypes: ["checking", "savings", "hsa", "cd", "money_market", "other"] },
  { category: "taxable", subTypes: ["brokerage", "529", "other"] },
  {
    category: "retirement",
    subTypes: ["traditional_ira", "roth_ira", "401k", "403b", "sep_ira", "simple_ira", "401a", "other"],
  },
  { category: "annuity", subTypes: ["other"] },
  { category: "real_estate", subTypes: ["primary_residence", "rental_property", "commercial_property", "other"] },
  { category: "business", subTypes: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc", "other"] },
  { category: "stock_options", subTypes: ["other"] },
  { category: "life_insurance", subTypes: ["term", "whole_life", "universal_life", "variable_life", "other"] },
  { category: "notes_receivable", subTypes: ["other"] },
];

const DEBT_TYPES: { value: string; label: string }[] = [
  { value: "credit_card", label: "Credit card" },
  { value: "mortgage", label: "Mortgage" },
  { value: "heloc", label: "HELOC" },
  { value: "auto", label: "Auto loan" },
  { value: "student", label: "Student loan" },
  { value: "personal", label: "Personal loan" },
  { value: "other", label: "Other debt" },
];

function formatBalance(balance: number | null): string {
  if (balance == null) return "—";
  return balance.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function PlaidAccountDecisionRow({
  account,
  state,
  onChange,
  existingCandidates,
  existingLiabilityCandidates,
}: {
  account: PlaidAvailableAccount;
  state: RowState;
  onChange: (patch: Partial<RowState>) => void;
  existingCandidates: LinkCandidate[];
  existingLiabilityCandidates: LiabilityCandidate[];
}): React.JSX.Element {
  const isDebt = mapPlaidToLiability(account.type, account.subtype) != null;
  const preferredCategory = mapPlaidToFoundry(account.type, account.subtype)?.category ?? null;
  const liabilityCandidates = existingLiabilityCandidates;
  const linkTargets = isDebt ? liabilityCandidates : existingCandidates;
  const canLink = linkTargets.length > 0;

  if (state.skipped) {
    return (
      <li className="flex items-center justify-between gap-3 py-3">
        <span className="truncate text-[13px] text-ink-3">
          <span className="line-through">{account.name}</span>
          {account.mask ? ` ··${account.mask}` : ""} — Skipped
        </span>
        <button
          type="button"
          onClick={() => onChange({ skipped: false })}
          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent/10"
        >
          Undo
        </button>
      </li>
    );
  }

  const selectLink = (existingId: string | null) => onChange({ mode: "link", existingId });
  const selectedLinkCandidate = existingCandidates.find((c) => c.id === state.existingId);
  const mismatch =
    state.mode === "link" &&
    !isDebt &&
    selectedLinkCandidate &&
    preferredCategory &&
    selectedLinkCandidate.category !== preferredCategory;

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink">
            {account.name}
            {account.mask ? <span className="ml-1 text-ink-3">··{account.mask}</span> : null}
          </div>
          <div className="tabular-nums text-[12px] text-ink-3">{formatBalance(account.balance)}</div>
        </div>
        <button
          type="button"
          aria-label={`Skip ${account.name}`}
          onClick={() => onChange({ skipped: true })}
          className="shrink-0 rounded-md p-1 text-[14px] leading-none text-ink-3 hover:bg-card-2 hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={state.mode === "create"}
          onClick={() => onChange({ mode: "create" })}
          className={`rounded-md border px-2.5 py-1 text-[12px] font-medium ${
            state.mode === "create"
              ? "border-accent bg-accent/15 text-accent"
              : "border-hair text-ink-2 hover:bg-card-2"
          }`}
        >
          Add as new
        </button>
        <button
          type="button"
          aria-pressed={state.mode === "link"}
          disabled={!canLink}
          onClick={() => selectLink(linkTargets[0]?.id ?? null)}
          className={`rounded-md border px-2.5 py-1 text-[12px] font-medium disabled:opacity-40 ${
            state.mode === "link"
              ? "border-accent bg-accent/15 text-accent"
              : "border-hair text-ink-2 hover:bg-card-2"
          }`}
        >
          {isDebt ? "Link to existing debt" : "Link to existing account"}
        </button>
      </div>

      {state.mode === "create" && (
        <label className="block">
          <span className="sr-only">Account type</span>
          <select
            aria-label="Account type"
            value={state.typeKey}
            onChange={(e) => onChange({ typeKey: e.target.value })}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
          >
            {ASSET_GROUPS.map((g) => (
              <optgroup key={g.category} label={CATEGORY_LABELS[g.category] ?? g.category}>
                {g.subTypes.map((s) => (
                  <option key={`${g.category}|${s}`} value={`asset|${g.category}|${s}`}>
                    {SUBTYPE_LABELS[s] ?? s}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Debt">
              {DEBT_TYPES.map((t) => (
                <option key={t.value} value={`debt|${t.value}`}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      )}

      {state.mode === "link" && (
        <label className="block">
          <span className="sr-only">{isDebt ? "Existing debt" : "Existing account"}</span>
          <select
            aria-label={isDebt ? "Existing debt" : "Existing account"}
            value={state.existingId ?? ""}
            onChange={(e) => selectLink(e.target.value || null)}
            className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
          >
            {isDebt
              ? liabilityCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.liabilityType ?? "—"})
                  </option>
                ))
              : existingCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({CATEGORY_LABELS[c.category] ?? c.category} ·{" "}
                    {SUBTYPE_LABELS[c.subType] ?? c.subType})
                  </option>
                ))}
          </select>
          {mismatch && (
            <p role="alert" className="mt-1 text-[12px] text-warn">
              These look like different account types — sure?
            </p>
          )}
        </label>
      )}
    </li>
  );
}
