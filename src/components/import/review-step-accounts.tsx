"use client";

import { useState } from "react";
import type { ExtractedAccount, AccountCategory, AccountSubType } from "@/lib/extraction/types";

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
  { value: "roth_401k", label: "Roth 401(k)" },
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

const OWNER_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
];

interface ReviewStepAccountsProps {
  accounts: ExtractedAccount[];
  onChange: (accounts: ExtractedAccount[]) => void;
  existingAccountNames?: string[];
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
}: ReviewStepAccountsProps) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

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
          const duplicate = findDuplicate(account.name);
          const isExcluded = excluded.has(i);

          return (
            <div
              key={i}
              className={`rounded-lg border p-3 ${
                isExcluded
                  ? "border-gray-700 bg-gray-900/30 opacity-50"
                  : "border-gray-700 bg-gray-900"
              }`}
            >
              {duplicate && !isExcluded && (
                <div className="mb-2 flex items-center gap-2 rounded bg-amber-900/30 px-2 py-1 text-xs text-amber-400">
                  <span>Possible duplicate of &quot;{duplicate}&quot;</span>
                  <button
                    onClick={() => toggleExclude(i)}
                    className="ml-auto text-amber-400 underline hover:text-amber-300"
                  >
                    Skip
                  </button>
                </div>
              )}
              {isExcluded && (
                <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                  <span>Skipped</span>
                  <button
                    onClick={() => toggleExclude(i)}
                    className="text-accent underline hover:text-accent-ink"
                  >
                    Include
                  </button>
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
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Owner</label>
                  <select
                    value={account.owner ?? "client"}
                    onChange={(e) => updateField(i, "owner", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {OWNER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Value</label>
                  <input
                    type="number"
                    value={account.value ?? ""}
                    onChange={(e) => updateField(i, "value", e.target.value ? Number(e.target.value) : undefined)}
                    className={account.value != null ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Cost Basis</label>
                  <input
                    type="number"
                    value={account.basis ?? ""}
                    onChange={(e) => updateField(i, "basis", e.target.value ? Number(e.target.value) : undefined)}
                    className={INPUT_CLASS}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Growth Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    value={account.growthRate != null ? account.growthRate : ""}
                    onChange={(e) => updateField(i, "growthRate", e.target.value ? Number(e.target.value) : null)}
                    className={EMPTY_CLASS}
                    placeholder="Use default"
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
                  <button
                    onClick={() => removeRow(i)}
                    className="ml-auto pb-1 text-gray-400 hover:text-red-400"
                    title="Remove"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
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
