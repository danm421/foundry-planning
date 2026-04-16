"use client";

import { useState, FormEvent } from "react";

interface DeductionRow {
  id: string;
  type: "charitable_cash" | "charitable_non_cash" | "salt" | "mortgage_interest" | "other_itemized";
  name: string | null;
  owner: "client" | "spouse" | "joint";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
}

interface AddDeductionFormProps {
  clientId: string;
  existing?: DeductionRow | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPE_OPTIONS: Array<{ value: DeductionRow["type"]; label: string }> = [
  { value: "charitable_cash", label: "Charitable (Cash)" },
  { value: "charitable_non_cash", label: "Charitable (Non-Cash)" },
  { value: "salt", label: "SALT (state + local taxes)" },
  { value: "mortgage_interest", label: "Mortgage Interest" },
  { value: "other_itemized", label: "Other Itemized" },
];

const INPUT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none";

export function AddDeductionForm({ clientId, existing, onClose, onSaved }: AddDeductionFormProps) {
  const [type, setType] = useState<DeductionRow["type"]>(existing?.type ?? "charitable_cash");
  const [name, setName] = useState(existing?.name ?? "");
  const [owner, setOwner] = useState<DeductionRow["owner"]>(existing?.owner ?? "joint");
  const [annualAmount, setAnnualAmount] = useState(existing?.annualAmount?.toString() ?? "");
  const [growthRate, setGrowthRate] = useState(existing ? (existing.growthRate * 100).toString() : "0");
  const [startYear, setStartYear] = useState(existing?.startYear ?? new Date().getFullYear());
  const [endYear, setEndYear] = useState(existing?.endYear ?? new Date().getFullYear() + 50);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body = {
        type,
        name: name || null,
        owner,
        annualAmount: parseFloat(annualAmount) || 0,
        growthRate: parseFloat(growthRate) / 100 || 0,
        startYear,
        endYear,
        startYearRef: null,
        endYearRef: null,
      };

      const url = existing
        ? `/api/clients/${clientId}/deductions/${existing.id}`
        : `/api/clients/${clientId}/deductions`;
      const method = existing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to save: ${(err as { error?: string }).error ?? res.statusText}`);
        return;
      }

      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">{existing ? "Edit deduction" : "Add deduction"}</h3>
          <button type="button" onClick={onClose} className="text-xl text-gray-400 hover:text-gray-200" aria-label="Close">
            ×
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DeductionRow["type"])}
            className={SELECT_CLASS}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {type === "salt" && (
          <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
            SALT is capped at $10,000 by federal law. Enter your total state + local taxes paid;
            the engine will apply the cap.
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-400">Name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., First Baptist Church"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400">Owner</label>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value as DeductionRow["owner"])}
            className={SELECT_CLASS}
          >
            <option value="joint">Joint</option>
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400">Annual amount ($)</label>
            <input
              type="number"
              step="100"
              min="0"
              value={annualAmount}
              onChange={(e) => setAnnualAmount(e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">Growth rate (% / yr)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={growthRate}
              onChange={(e) => setGrowthRate(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400">Start year</label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={startYear}
              onChange={(e) => setStartYear(Number(e.target.value))}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">End year</label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={endYear}
              onChange={(e) => setEndYear(Number(e.target.value))}
              required
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
