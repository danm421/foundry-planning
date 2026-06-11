"use client";

import { useEffect, useState } from "react";
import type { ExtractedAccount, AccountCategory, AccountSubType, ExtractedHolding } from "@/lib/extraction/types";
import { holdingsReconciliation, holdingMarketValue } from "@/lib/extraction/normalize-holdings";
import type { MatchAnnotation } from "@/lib/imports/types";
import type { FieldMap } from "@/lib/imports/merge-strategies";
import { CurrencyInput } from "@/components/currency-input";
import { GrowthRateField, parseGrowthSourceSelection } from "@/components/forms/growth-rate-field";
import { OwnershipEditor } from "@/components/forms/ownership-editor";
import { matchOwnersFromHint } from "@/lib/imports/owner-match";
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
// preview matches what the commit step will actually write.
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

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-accent focus:outline-none";

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

  // Seed each row's owners[] from the AI name hint + coarse owner enum once the
  // family roster loads. Rows the advisor has already given owners are left
  // untouched. Re-runs only when the roster identity changes, not on row edits.
  useEffect(() => {
    if (familyMembers.length === 0) return;
    let changed = false;
    const next = accounts.map((a) => {
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
        <h3 className="text-lg font-medium text-gray-100">
          Accounts ({accounts.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-accent hover:bg-gray-700"
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
          // Suppress the v1 name-overlap heuristic when match annotations are
          // present — the match column is the authoritative signal.
          const duplicate = matchingEnabled ? null : findDuplicate(account.name);

          return (
            <div
              key={i}
              className={`rounded-lg border p-3 ${
                isExcluded
                  ? "border-gray-700 bg-gray-900/30 opacity-50"
                  : "border-gray-700 bg-gray-900"
              }`}
            >
              {(matchingEnabled || duplicate || isExcluded) && (
                <div className="mb-2 flex items-center gap-2">
                  {matchingEnabled && (
                    <MatchColumn
                      match={match}
                      existingName={existingRow?.name}
                      candidates={candidates}
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
                    <div className="ml-auto flex items-center gap-2 rounded bg-amber-900/30 px-2 py-1 text-xs text-amber-400">
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
                    <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
                      <span>Skipped</span>
                      <button
                        onClick={() => toggleExclude(i)}
                        className="text-accent underline hover:text-accent-ink"
                      >
                        Include
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-gray-300">Name</label>
                  <input
                    value={account.name}
                    onChange={(e) => updateField(i, "name", e.target.value)}
                    className={account.name ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder="Account name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Category</label>
                  <select
                    value={account.category ?? ""}
                    onChange={(e) => updateField(i, "category", e.target.value || undefined)}
                    className={account.category ? SELECT_CLASS : `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`}
                  >
                    <option value="">Select...</option>
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Type</label>
                  <select
                    value={account.subType ?? ""}
                    onChange={(e) => updateField(i, "subType", e.target.value || undefined)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Select...</option>
                    {SUB_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
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
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Value</label>
                  <CurrencyInput
                    value={account.value != null ? String(account.value) : ""}
                    onChange={(raw) => updateField(i, "value", raw === "" ? undefined : Number(raw))}
                    className={account.value != null ? "" : TINT_EMPTY}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Cost Basis</label>
                  <CurrencyInput
                    value={account.basis != null ? String(account.basis) : ""}
                    onChange={(raw) => updateField(i, "basis", raw === "" ? undefined : Number(raw))}
                    placeholder="Optional"
                  />
                </div>
                <div>
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
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Acct ####</label>
                  <input
                    value={account.accountNumberLast4 ?? ""}
                    onChange={(e) => updateField(i, "accountNumberLast4", e.target.value || undefined)}
                    className={INPUT_CLASS}
                    placeholder="Last 4"
                    maxLength={4}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Custodian</label>
                  <input
                    value={account.custodian ?? ""}
                    onChange={(e) => updateField(i, "custodian", e.target.value || undefined)}
                    className={INPUT_CLASS}
                    placeholder="e.g. Fidelity"
                  />
                </div>
                <div className="col-span-2 flex items-end gap-2">
                  <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={account.rmdEnabled ?? false}
                      onChange={(e) => updateField(i, "rmdEnabled", e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                    />
                    RMD
                  </label>
                  <SourceBadge row={account} className="ml-auto pb-1" />
                  <button
                    onClick={() => removeRow(i)}
                    className="pb-1 text-white hover:text-white"
                    title="Remove"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {isExpanded && existingRow && (
                <div className="mt-3 rounded border border-hair bg-gray-950/40 p-3">
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
                      <span className={recon.flagged ? "text-xs text-bad" : "text-xs text-ink-4"}>
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
                            <td><input className="w-20 bg-transparent text-right" value={h.shares ?? ""} onChange={(e) => setField(hi, { shares: num(e.target.value) })} /></td>
                            <td><input className="w-20 bg-transparent text-right" value={h.price ?? ""} onChange={(e) => setField(hi, { price: num(e.target.value) })} /></td>
                            <td className="text-right text-ink-3">${Math.round(holdingMarketValue(h)).toLocaleString()}</td>
                            <td><input className="w-24 bg-transparent text-right" value={h.costBasis ?? ""} onChange={(e) => setField(hi, { costBasis: num(e.target.value) })} /></td>
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

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
