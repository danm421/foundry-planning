"use client";

import type { ExtractedIncome, IncomeType } from "@/lib/extraction/types";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";

// Layered on top of CurrencyInput/PercentInput's own inputClassName baseline
// to flag fields the AI didn't extract.
const TINT_EMPTY = "bg-amber-900/20 border-amber-600/50";

const INCOME_TYPE_OPTIONS: { value: IncomeType; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "social_security", label: "Social Security" },
  { value: "business", label: "Business" },
  { value: "deferred", label: "Deferred Comp" },
  { value: "capital_gains", label: "Capital Gains" },
  { value: "trust", label: "Trust" },
  { value: "other", label: "Other" },
];

const OWNER_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
];

interface ReviewStepIncomesProps {
  incomes: ExtractedIncome[];
  onChange: (incomes: ExtractedIncome[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-accent focus:outline-none";

export default function ReviewStepIncomes({
  incomes,
  onChange,
  defaultStartYear,
  defaultEndYear,
}: ReviewStepIncomesProps) {
  const updateField = (index: number, field: keyof ExtractedIncome, value: unknown) => {
    const updated = incomes.map((inc, i) =>
      i === index ? { ...inc, [field]: value } : inc
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([
      ...incomes,
      { name: "", type: "salary", startYear: defaultStartYear, endYear: defaultEndYear },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(incomes.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Income ({incomes.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-accent hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {incomes.map((income, i) => (
          <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-gray-300">Name</label>
                <input
                  value={income.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={income.name ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="Income source name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Type</label>
                <select
                  value={income.type ?? ""}
                  onChange={(e) => updateField(i, "type", e.target.value || undefined)}
                  className={income.type ? SELECT_CLASS : `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`}
                >
                  <option value="">Select...</option>
                  {INCOME_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Annual Amount</label>
                <CurrencyInput
                  value={income.annualAmount != null ? String(income.annualAmount) : ""}
                  onChange={(raw) => updateField(i, "annualAmount", raw === "" ? undefined : Number(raw))}
                  className={income.annualAmount != null ? "" : TINT_EMPTY}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Owner</label>
                <select
                  value={income.owner ?? "client"}
                  onChange={(e) => updateField(i, "owner", e.target.value)}
                  className={SELECT_CLASS}
                >
                  {OWNER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Start Year</label>
                <input
                  type="number"
                  value={income.startYear ?? ""}
                  onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={income.startYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultStartYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">End Year</label>
                <input
                  type="number"
                  value={income.endYear ?? ""}
                  onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={income.endYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultEndYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Growth Rate</label>
                <PercentInput
                  value={income.growthRate != null ? (income.growthRate * 100).toFixed(2) : ""}
                  onChange={(raw) => updateField(i, "growthRate", raw === "" ? undefined : Number(raw) / 100)}
                  className={TINT_EMPTY}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-gray-400 hover:text-red-400"
                  title="Remove"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        ))}
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
