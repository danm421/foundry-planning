"use client";

import { useEffect, useState } from "react";
import type { ExtractedAccount, AccountCategory, AccountSubType, ExtractedHolding } from "@/lib/extraction/types";
import { holdingsReconciliation, holdingMarketValue } from "@/lib/extraction/normalize-holdings";
import type { MatchAnnotation } from "@/lib/imports/types";
import type { FieldMap } from "@/lib/imports/merge-strategies";
import { candidatesForRow } from "@/lib/imports/candidates-for-row";
import { CurrencyInput } from "@/components/currency-input";
import { GrowthRateField, parseGrowthSourceSelection } from "@/components/forms/growth-rate-field";
import { inputClassName, selectClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import { OwnershipEditor } from "@/components/forms/ownership-editor";
import { matchFamilyMemberByName, matchOwnersFromHint } from "@/lib/imports/owner-match";
import { is529Account } from "@/lib/accounts/is-529";
import type { GrowthSource } from "@/lib/investments/allocation";
import type { AccountOwner } from "@/engine/ownership";
import MatchColumn from "./match-column";
import type { MatchCandidate } from "./match-link-picker";
import DiffPreview from "./diff-preview";
import SourceBadge from "./source-badge";

// Layered on top of CurrencyInput/PercentInput's own inputClassName baseline
// to flag fields the AI didn't extract — same amber cue as the legacy
// EMPTY_CLASS on plain inputs.
const TINT_EMPTY = "bg-amber-900/20 border-amber-600/50";

const CATEGORY_OPTIONS: { value: AccountCategory; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "cash", label: "Cash" },
  { value: "retirement", label: "Retirement" },
  { value: "real_estate", label: "Real Estate" },
  { value: "business", label: "Business" },
  { value: "life_insurance", label: "Life Insurance" },
  // Label matches the canonical mapping in src/lib/accounts/category-labels.ts
  // (ACCOUNT_CATEGORY_LABELS) — reused everywhere else this category displays.
  { value: "education_savings", label: "529 / Education" },
];

const SUB_TYPE_OPTIONS: { value: AccountSubType; label: string }[] = [
  { value: "brokerage", label: "Brokerage" },
  { value: "savings", label: "Savings" },
  { value: "checking", label: "Checking" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "403b", label: "403(b)" },
  { value: "529", label: "529 Plan" },
  { value: "trust", label: "Trust" },
  { value: "other", label: "Other" },
  { value: "primary_residence", label: "Primary Residence" },
  { value: "rental_property", label: "Rental Property" },
  { value: "commercial_property", label: "Commercial Property" },
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "llc", label: "LLC" },
  { value: "term", label: "Term Life" },
  { value: "whole_life", label: "Whole Life" },
  { value: "universal_life", label: "Universal Life" },
  { value: "variable_life", label: "Variable Life" },
];

// Mirrors the field map in src/lib/imports/commit/accounts.ts so the diff
// preview matches what the commit step will actually write. The 529
// beneficiary/grantor columns are deliberately absent: they are stored as
// family-member UUIDs, and a diff row reading "Beneficiary: 3f2a…" tells the
// advisor less than no diff row at all.
const ACCOUNT_FIELD_MAP: FieldMap<ExtractedAccount> = {
  name: "keep-existing",
  category: "replace",
  subType: "replace",
  value: "replace",
  basis: "replace",
  accountNumberLast4: "replace",
  custodian: "replace",
  growthRate: "replace-if-non-null",
  growthSource: "replace",
  modelPortfolioId: "replace",
  tickerPortfolioId: "replace",
  rmdEnabled: "replace-if-non-null",
};

const ACCOUNT_FIELD_LABELS: Partial<Record<keyof ExtractedAccount, string>> = {
  category: "Category",
  subType: "Type",
  value: "Value",
  basis: "Cost basis",
  accountNumberLast4: "Account ####",
  custodian: "Custodian",
  growthRate: "Growth rate",
  growthSource: "Growth source",
  modelPortfolioId: "Model portfolio",
  tickerPortfolioId: "Fund portfolio",
  rmdEnabled: "RMD",
};

interface ReviewStepAccountsProps {
  accounts: ExtractedAccount[];
  onChange: (accounts: ExtractedAccount[]) => void;
  existingAccountNames?: string[];
  /**
   * Per-row match annotation. When omitted the match column stays hidden
   * and the component behaves like v1 (used by the legacy review-wizard
   * until 8.9 swaps it). Index aligns with `accounts`.
   */
  matches?: Array<MatchAnnotation | undefined>;
  /** Called when the user resolves a match via the link picker. */
  onMatchChange?: (index: number, match: MatchAnnotation) => void;
  /** Candidate list passed to the match-link picker (typically all client accounts). */
  candidates?: MatchCandidate[];
  /**
   * Existing canonical rows keyed by id, used by the diff preview when a
   * row is matched exact. Only the fields in ACCOUNT_FIELD_MAP are read.
   */
  existingAccountsById?: Record<string, Partial<ExtractedAccount> & { name?: string }>;
  modelPortfolios?: { id: string; name: string; blendedReturn: number }[];
  fundPortfolios?: { id: string; name: string; blendedReturnPct: number | null }[];
  resolvedInflationRate?: number;
  categoryDefaults?: Record<string, { portfolioName?: string | null; blendedReturnPct: number | null }>;
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string; lastName?: string | null }[];
  entities?: { id: string; name: string }[];
}

// Reuse the shared dialog-form styling instead of local gray-* classes. This
// card renders CurrencyInput, GrowthRateField and OwnershipEditor as children,
// and all three already style themselves from input-styles.ts — the old local
// constants gave the card's own fields a different height (py-1.5 vs h-9),
// radius, font size and label colour than the children sitting beside them.
const INPUT_CLASS = inputClassName;
const SELECT_CLASS = selectClassName;
const EMPTY_CLASS = `${inputClassName} ${TINT_EMPTY}`;

// Money and IDs render in the brand's tabular mono (B612 Mono) — per the design
// system every dollar amount and account identifier is mono, not Inter.
const TABULAR = "tabular";

export default function ReviewStepAccounts({
  accounts,
  onChange,
  existingAccountNames = [],
  matches,
  onMatchChange,
  candidates = [],
  existingAccountsById,
  modelPortfolios = [],
  fundPortfolios = [],
  resolvedInflationRate = 0.025,
  categoryDefaults = {},
  familyMembers = [],
  entities = [],
}: ReviewStepAccountsProps) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const matchingEnabled = Boolean(matches && onMatchChange);

  // Seed each row's people from the AI name hints once the family roster loads.
  // Rows the advisor has already resolved are left untouched. Re-runs only when
  // the roster identity changes, not on row edits.
  //
  // A 529 takes a different pair of people entirely: its designated beneficiary
  // and its participant/grantor. It never gets owners[] — the commit writes no
  // account_owners rows for one — so seeding ownership on a 529 would only
  // manufacture a value nothing reads.
  useEffect(() => {
    if (familyMembers.length === 0) return;
    let changed = false;
    /**
     * Seed ONE of a 529's two people from the name the statement printed.
     * Returns the (id, name) pair to write, or null when there is nothing to
     * seed — the advisor already resolved this person, or nothing was printed.
     *
     * A confident single roster match becomes an id; anything else keeps the
     * printed name as free text rather than guessing which child the money is
     * for. Exactly one of the two is ever set, which is the invariant the
     * commit step and the accounts table both rely on.
     */
    const seed = (
      current: { id?: string | null; name?: string | null },
      hint: string | undefined,
      restrictTo?: Parameters<typeof matchFamilyMemberByName>[2],
    ): { id: string | null; name: string | null } | null => {
      if (current.id != null || current.name != null || !hint) return null;
      const fm = matchFamilyMemberByName(hint, familyMembers, restrictTo);
      return fm ? { id: fm.id, name: null } : { id: null, name: hint };
    };

    const next = accounts.map((a) => {
      if (is529Account(a)) {
        let row = a;
        const b = seed({ id: row.beneficiaryFamilyMemberId, name: row.beneficiaryName }, row.beneficiaryNameHint);
        if (b) {
          row = { ...row, beneficiaryFamilyMemberId: b.id, beneficiaryName: b.name };
          changed = true;
        }
        // Household grantors are the client/spouse only — anyone else (a
        // grandparent participant) funds it from outside the plan's cash flow.
        const g = seed(
          { id: row.grantorFamilyMemberId, name: row.grantorName },
          row.grantorNameHint,
          ["client", "spouse"],
        );
        if (g) {
          row = { ...row, grantorFamilyMemberId: g.id, grantorName: g.name };
          changed = true;
        }
        return row;
      }
      if (a.owners && a.owners.length > 0) return a;
      const seeded = matchOwnersFromHint(a.ownerNameHint, a.owner, familyMembers);
      if (seeded.length === 0) return a;
      changed = true;
      return { ...a, owners: seeded };
    });
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyMembers]);

  const updateField = (index: number, field: keyof ExtractedAccount, value: unknown) => {
    const updated = accounts.map((a, i) =>
      i === index ? { ...a, [field]: value } : a
    );
    onChange(updated);
  };

  /**
   * Category / sub-type edits, which can turn a row into (or out of) a 529.
   * Reclassifying INTO a 529 drops the RMD flag: the checkbox disappears with
   * the category, and a stale `true` left behind would ride into the commit
   * where the advisor can no longer see it.
   */
  const updateClassification = (
    index: number,
    field: "category" | "subType",
    value: AccountCategory | AccountSubType | undefined,
  ) => {
    onChange(
      accounts.map((a, i) => {
        if (i !== index) return a;
        const next = { ...a, [field]: value };
        return is529Account(next) ? { ...next, rmdEnabled: false } : next;
      }),
    );
  };

  const set529Person = (
    index: number,
    kind: "beneficiary" | "grantor",
    familyMemberId: string | null,
    name: string | null,
  ) => {
    // Spelled out per person rather than built from `${kind}FamilyMemberId`:
    // computed keys would make the column names ungreppable.
    const patch =
      kind === "beneficiary"
        ? { beneficiaryFamilyMemberId: familyMemberId, beneficiaryName: name }
        : { grantorFamilyMemberId: familyMemberId, grantorName: name };
    onChange(accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const addRow = () => {
    onChange([...accounts, { name: "" }]);
  };

  const removeRow = (index: number) => {
    onChange(accounts.filter((_, i) => i !== index));
  };

  const toggleExclude = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleExpanded = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const findDuplicate = (name: string): string | null => {
    if (!name) return null;
    const lower = name.toLowerCase();
    return existingAccountNames.find(
      (existing) => existing.toLowerCase().includes(lower) || lower.includes(existing.toLowerCase())
    ) ?? null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[17px] font-semibold text-ink">
          Accounts ({accounts.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-sm text-accent transition-colors hover:border-hair-2"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {accounts.map((account, i) => {
          const match = matches?.[i];
          const existingId = match?.kind === "exact" ? match.existingId : null;
          const existingRow = existingId ? existingAccountsById?.[existingId] : undefined;
          const isExpanded = expanded.has(i);
          const isExcluded = excluded.has(i);
          // A 529 is attributed to its designated beneficiary, is out of the
          // household estate, and can never take an RMD — so this row swaps
          // its ownership editor for the beneficiary/grantor pair and drops
          // the RMD control entirely.
          const is529 = is529Account(account);
          // Suppress the v1 name-overlap heuristic when match annotations are
          // present — the match column is the authoritative signal.
          const duplicate = matchingEnabled ? null : findDuplicate(account.name);

          return (
            <div
              key={i}
              // `paper`, not `card`: the drawer itself is `bg-card`, so a card-
              // surfaced row would vanish into it. Recessing to the page canvas
              // keeps the original gray-900 intent — the row reads as a well,
              // and its `card-2` inputs sit visibly raised inside it.
              className={`rounded-lg border p-3 ${
                isExcluded
                  ? "border-hair bg-paper/50 opacity-50"
                  : "border-hair bg-paper"
              }`}
            >
              {/* Header renders unconditionally so the row actions (source badge +
                  delete) have a fixed home. They used to live in a grid cell next
                  to the RMD checkbox, which put a destructive control in an
                  arbitrary spot and left a ragged gap when the row had no match. */}
              <div className="mb-3 flex items-center gap-2">
                {matchingEnabled && (
                  <MatchColumn
                    match={match}
                    existingName={existingRow?.name}
                    candidates={candidatesForRow(i, matches ?? [], candidates)}
                    entityKind="account"
                    onChange={(next) => onMatchChange?.(i, next)}
                  />
                )}
                {existingRow && (
                  <button
                    onClick={() => toggleExpanded(i)}
                    className="text-xs text-accent underline hover:text-accent-ink"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "Hide diff" : "Show diff"}
                  </button>
                )}
                {duplicate && !isExcluded && (
                  <div className="flex items-center gap-2 rounded bg-amber-900/30 px-2 py-1 text-xs text-amber-400">
                    <span>Possible duplicate of &quot;{duplicate}&quot;</span>
                    <button
                      onClick={() => toggleExclude(i)}
                      className="text-amber-400 underline hover:text-amber-300"
                    >
                      Skip
                    </button>
                  </div>
                )}
                {isExcluded && (
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <span>Skipped</span>
                    <button
                      onClick={() => toggleExclude(i)}
                      className="text-accent underline hover:text-accent-ink"
                    >
                      Include
                    </button>
                  </div>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <SourceBadge row={account} />
                  <button
                    onClick={() => removeRow(i)}
                    className="rounded p-1.5 text-ink-3 transition-colors hover:bg-card-2 hover:text-crit"
                    aria-label={`Remove ${account.name || "account"}`}
                    title="Remove account"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {/* 12 columns, not 6: at ~512px of drawer width a 6-col grid gives
                  each field ~80px, which truncated every value and wrapped the
                  "Growth Rate" label onto a second line — that wrap is what
                  knocked the row out of alignment. 12 cols lets each field claim
                  a width matched to its content, grouped identity → money →
                  provenance so related fields read as a band. */}
              <div className="grid grid-cols-12 gap-x-2 gap-y-3">
                {/* ── Identity: what is this account? ── */}
                <div className="col-span-6">
                  <label className={fieldLabelClassName}>Name</label>
                  {existingRow?.name ? (
                    // Matched rows keep the existing account's name — commitAccounts
                    // maps `name` as keep-existing, so an editable input here would
                    // be a false affordance. Rename on the account page instead.
                    <div className="px-1 py-1">
                      <div className="text-[14px] text-ink">{existingRow.name}</div>
                      {/* NOT the document's own header text: extract.ts runs
                          every extracted account name through
                          composeAccountName before the payload is persisted,
                          and the prompt asks the model for the account type
                          rather than a transcription of the statement.
                          "extracted" is what this actually is. */}
                      <div className="mt-0.5 text-xs text-ink-4">
                        extracted: {account.name}
                      </div>
                    </div>
                  ) : (
                    <input
                      value={account.name}
                      onChange={(e) => updateField(i, "name", e.target.value)}
                      className={account.name ? INPUT_CLASS : EMPTY_CLASS}
                      placeholder="Account name"
                    />
                  )}
                </div>
                <div className="col-span-3">
                  <label className={fieldLabelClassName}>Category</label>
                  <select
                    value={account.category ?? ""}
                    onChange={(e) =>
                      updateClassification(i, "category", (e.target.value || undefined) as AccountCategory | undefined)
                    }
                    className={account.category ? SELECT_CLASS : `${SELECT_CLASS} ${TINT_EMPTY}`}
                    // Long labels ("529 / Education") still clip in 3 columns; the
                    // tooltip is the documented fallback for a truncated control.
                    title={CATEGORY_OPTIONS.find((o) => o.value === account.category)?.label}
                  >
                    <option value="">Select...</option>
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className={fieldLabelClassName}>Type</label>
                  <select
                    value={account.subType ?? ""}
                    onChange={(e) =>
                      updateClassification(i, "subType", (e.target.value || undefined) as AccountSubType | undefined)
                    }
                    className={SELECT_CLASS}
                    title={SUB_TYPE_OPTIONS.find((o) => o.value === account.subType)?.label}
                  >
                    <option value="">Select...</option>
                    {SUB_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* ── Money: what is it worth, and how does it grow? ── */}
                <div className="col-span-4">
                  <label className={fieldLabelClassName}>Value</label>
                  <CurrencyInput
                    value={account.value != null ? String(account.value) : ""}
                    onChange={(raw) => updateField(i, "value", raw === "" ? undefined : Number(raw))}
                    className={account.value != null ? TABULAR : `${TABULAR} ${TINT_EMPTY}`}
                    placeholder="0"
                  />
                </div>
                <div className="col-span-4">
                  <label className={fieldLabelClassName}>Cost Basis</label>
                  <CurrencyInput
                    value={account.basis != null ? String(account.basis) : ""}
                    onChange={(raw) => updateField(i, "basis", raw === "" ? undefined : Number(raw))}
                    className={TABULAR}
                    placeholder="Optional"
                  />
                </div>
                <div className="col-span-4">
                  <GrowthRateField
                    category={account.category ?? "taxable"}
                    growthSource={(account.growthSource as GrowthSource) ?? (account.growthRate != null ? "custom" : "default")}
                    modelPortfolioId={account.modelPortfolioId ?? ""}
                    tickerPortfolioId={account.tickerPortfolioId ?? ""}
                    growthRatePct={account.growthRate != null ? (account.growthRate * 100).toFixed(2) : ""}
                    modelPortfolios={modelPortfolios}
                    fundPortfolios={fundPortfolios}
                    defaultPctForCategory={categoryDefaults[account.category ?? "taxable"]?.blendedReturnPct ?? null}
                    catDefaultPortfolioName={categoryDefaults[account.category ?? "taxable"]?.portfolioName ?? null}
                    resolvedInflationRate={resolvedInflationRate}
                    assetMixBlendedPct={null}
                    customPlaceholder="Use default"
                    onSourceChange={(raw) => {
                      const { growthSource, modelPortfolioId, tickerPortfolioId } = parseGrowthSourceSelection(raw);
                      const updated = accounts.map((a, idx) =>
                        idx === i
                          ? {
                              ...a,
                              growthSource,
                              modelPortfolioId,
                              tickerPortfolioId,
                              // Clearing to non-custom drops the explicit % (commit treats null = use default).
                              growthRate: growthSource === "custom" ? a.growthRate : null,
                            }
                          : a,
                      );
                      onChange(updated);
                    }}
                    onCustomPctChange={(raw) =>
                      updateField(i, "growthRate", raw === "" ? null : Number(raw) / 100)
                    }
                  />
                </div>
                {/* ── Provenance: where did it come from, how is it handled? ── */}
                <div className="col-span-3">
                  <label className={fieldLabelClassName}>Acct ####</label>
                  <input
                    value={account.accountNumberLast4 ?? ""}
                    onChange={(e) => updateField(i, "accountNumberLast4", e.target.value || undefined)}
                    className={`${INPUT_CLASS} ${TABULAR}`}
                    placeholder="Last 4"
                    maxLength={4}
                    inputMode="numeric"
                  />
                </div>
                {/* A 529 has no RMD control, so the custodian claims the space
                    the checkbox would have taken rather than leaving a gap. */}
                <div className={is529 ? "col-span-9" : "col-span-5"}>
                  <label className={fieldLabelClassName}>Custodian</label>
                  <input
                    value={account.custodian ?? ""}
                    onChange={(e) => updateField(i, "custodian", e.target.value || undefined)}
                    className={INPUT_CLASS}
                    placeholder={is529 ? "e.g. Vanguard / state plan" : "e.g. Fidelity"}
                  />
                </div>
                {/* h-9 on the inner label matches the sibling inputs' height so the
                    checkbox sits on their centre line rather than floating. */}
                {!is529 && (
                  <div className="col-span-4">
                    <label className={fieldLabelClassName}>RMD</label>
                    <label className="flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={account.rmdEnabled ?? false}
                        onChange={(e) => updateField(i, "rmdEnabled", e.target.checked)}
                        className="h-4 w-4 rounded border-hair bg-card-2 text-accent focus:ring-2 focus:ring-accent/25"
                      />
                      Take RMDs
                    </label>
                  </div>
                )}
              </div>

              {/* People. A 529's two people are the beneficiary and the
                  participant/grantor — it carries no account_owners rows at
                  all, so the ownership editor would be a false affordance.
                  Every other category gets its own full-width band rather than
                  a grid cell: inside the 6-col grid it only had ~1/3 of the
                  drawer, so the preset bar wrapped into a vertical stack and
                  stretched the whole grid row. Full width lets the presets flow
                  left-to-right. */}
              {is529 ? (
                <div className="mt-3 space-y-2 border-t border-hair pt-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-4">
                      529 plan
                    </span>
                    <span className="text-[11px] text-ink-4">
                      Held for the beneficiary — out of the household estate, and never subject to RMDs.
                    </span>
                  </div>
                  <div className="grid grid-cols-12 gap-x-2 gap-y-3">
                    <div className="col-span-6">
                      <Person529Field
                        label="Beneficiary"
                        required
                        hint={account.beneficiaryNameHint}
                        placeholder="e.g. grandchild's name"
                        options={familyMembers}
                        familyMemberId={account.beneficiaryFamilyMemberId}
                        name={account.beneficiaryName}
                        onChange={(id, nm) => set529Person(i, "beneficiary", id, nm)}
                        missingMessage="Required — a 529 is attributed to its designated beneficiary."
                      />
                    </div>
                    <div className="col-span-6">
                      <Person529Field
                        label="Grantor"
                        hint={account.grantorNameHint}
                        placeholder="e.g. grandparent's name"
                        // Only the client/spouse can fund contributions out of
                        // household cash flow; anyone else funds it from outside.
                        options={familyMembers.filter((f) => f.role === "client" || f.role === "spouse")}
                        familyMemberId={account.grantorFamilyMemberId}
                        name={account.grantorName}
                        onChange={(id, nm) => set529Person(i, "grantor", id, nm)}
                        help="A household grantor funds contributions from plan cash flow. Anyone else funds it from outside."
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 border-t border-hair pt-3">
                  <OwnershipEditor
                    familyMembers={familyMembers}
                    entities={entities}
                    value={(account.owners as AccountOwner[]) ?? []}
                    onChange={(next) => updateField(i, "owners", next)}
                    titlingType="jtwros"
                    onTitlingTypeChange={() => {}}
                    label="Owner(s)"
                  />
                </div>
              )}

              {isExpanded && existingRow && (
                <div className="mt-3 rounded border border-hair bg-card-2/40 p-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-4">
                    Changes vs. existing
                    {existingRow.name ? <span className="ml-1 text-ink-3">— {existingRow.name}</span> : null}
                  </div>
                  <DiffPreview<ExtractedAccount>
                    existing={existingRow as ExtractedAccount}
                    incoming={account}
                    fieldMap={ACCOUNT_FIELD_MAP}
                    fieldLabels={ACCOUNT_FIELD_LABELS}
                  />
                </div>
              )}

              {account.holdings && account.holdings.length > 0 ? (() => {
                const recon = holdingsReconciliation(account.holdings, account.value);
                const update = (next: ExtractedHolding[]) => {
                  const copy = accounts.slice();
                  copy[i] = { ...account, holdings: next };
                  onChange(copy);
                };
                const setField = (hi: number, patch: Partial<ExtractedHolding>) =>
                  update(account.holdings!.map((h, j) => (j === hi ? { ...h, ...patch } : h)));
                const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
                return (
                  <div className="mt-3 rounded border border-hair p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-ink-4">
                        Holdings ({account.holdings.length})
                      </span>
                      <span className={recon.flagged ? "tabular text-xs text-bad" : "tabular text-xs text-ink-4"}>
                        Holdings ${Math.round(recon.sum).toLocaleString()} vs. stated ${Math.round(recon.total).toLocaleString()}
                        {recon.flagged ? " — review the gap" : ""}
                      </span>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="text-ink-4">
                        <tr>
                          <th className="text-left font-normal">Ticker</th>
                          <th className="text-left font-normal">Name</th>
                          <th className="text-right font-normal">Shares</th>
                          <th className="text-right font-normal">Price</th>
                          <th className="text-right font-normal">Mkt value</th>
                          <th className="text-right font-normal">Cost basis</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {account.holdings.map((h, hi) => (
                          <tr key={hi}>
                            <td><input className="w-16 bg-transparent" value={h.ticker ?? ""} onChange={(e) => setField(hi, { ticker: e.target.value || undefined })} /></td>
                            <td><input className="w-40 bg-transparent" value={h.name ?? ""} onChange={(e) => setField(hi, { name: e.target.value || undefined })} /></td>
                            <td><input className="tabular w-20 bg-transparent text-right" value={h.shares ?? ""} onChange={(e) => setField(hi, { shares: num(e.target.value) })} /></td>
                            <td><input className="tabular w-20 bg-transparent text-right" value={h.price ?? ""} onChange={(e) => setField(hi, { price: num(e.target.value) })} /></td>
                            <td className="tabular text-right text-ink-3">${Math.round(holdingMarketValue(h)).toLocaleString()}</td>
                            <td><input className="tabular w-24 bg-transparent text-right" value={h.costBasis ?? ""} onChange={(e) => setField(hi, { costBasis: num(e.target.value) })} /></td>
                            <td className="text-right">
                              <button type="button" className="text-ink-4 hover:text-bad" onClick={() => update(account.holdings!.filter((_, j) => j !== hi))}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button type="button" className="mt-2 text-xs text-accent" onClick={() => update([...account.holdings!, {}])}>
                      + Add holding
                    </button>
                  </div>
                );
              })() : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Sentinel option: the person isn't on the family roster, so name them freehand. */
const NAMED_PERSON = "__named__";

/**
 * One person on a 529 — its beneficiary or its grantor. The accounts table
 * stores exactly one of (familyMemberId, name) for each, so this is a single
 * roster picker with a "Someone else…" escape hatch rather than two rival
 * controls: choosing either side clears the other, which is the invariant.
 *
 * `hint` is what the statement actually printed. It stays visible even after
 * the pick resolves, so the advisor can check the match instead of trusting it.
 *
 * The canonical statement of these rules — id-or-name exclusivity, a
 * client/spouse-only grantor, a required beneficiary — is the
 * `category === "education_savings"` block in
 * src/components/forms/add-account-form.tsx, which is where a 529 is edited for
 * the rest of its life. This is a compact mirror for the review grid: a select
 * with a "Someone else…" sentinel where the form uses a radio pair, because a
 * review row has one grid cell, not a dialog. Change one, check the other.
 */
function Person529Field({
  label,
  required = false,
  hint,
  help,
  placeholder,
  options,
  familyMemberId,
  name,
  onChange,
  missingMessage,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  help?: string;
  placeholder: string;
  options: { id: string; firstName: string; lastName?: string | null }[];
  familyMemberId?: string | null;
  name?: string | null;
  onChange: (familyMemberId: string | null, name: string | null) => void;
  missingMessage?: string;
}) {
  const usingName = !familyMemberId && name != null;
  const missing = required && !familyMemberId && !(name ?? "").trim();

  return (
    <div>
      <label className={fieldLabelClassName}>
        {label}
        {required ? <span className="text-crit"> *</span> : null}
      </label>
      <select
        aria-label={label}
        value={familyMemberId ?? (usingName ? NAMED_PERSON : "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NAMED_PERSON) onChange(null, name ?? "");
          else if (v === "") onChange(null, null);
          else onChange(v, null);
        }}
        className={missing ? `${SELECT_CLASS} ${TINT_EMPTY}` : SELECT_CLASS}
      >
        <option value="">Select...</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.firstName}</option>
        ))}
        <option value={NAMED_PERSON}>Someone else…</option>
      </select>
      {usingName && (
        <input
          aria-label={`${label} name`}
          value={name ?? ""}
          onChange={(e) => onChange(null, e.target.value)}
          placeholder={placeholder}
          className={`mt-1.5 ${missing ? EMPTY_CLASS : INPUT_CLASS}`}
        />
      )}
      {hint ? <p className="mt-1 text-[11px] text-ink-4">Statement: {hint}</p> : null}
      {missing && missingMessage ? (
        <p className="mt-1 text-[11px] text-crit">{missingMessage}</p>
      ) : null}
      {!missing && help ? <p className="mt-1 text-[11px] text-ink-4">{help}</p> : null}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
