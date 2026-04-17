"use client";

import type { ExtractedLiability } from "@/lib/extraction/types";

interface ReviewStepLiabilitiesProps {
  liabilities: ExtractedLiability[];
  onChange: (liabilities: ExtractedLiability[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function ReviewStepLiabilities({
  liabilities,
  onChange,
  defaultStartYear,
  defaultEndYear,
}: ReviewStepLiabilitiesProps) {
  const updateField = (index: number, field: keyof ExtractedLiability, value: unknown) => {
    const updated = liabilities.map((l, i) =>
      i === index ? { ...l, [field]: value } : l
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([
      ...liabilities,
      { name: "", startYear: defaultStartYear, endYear: defaultEndYear },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(liabilities.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Liabilities ({liabilities.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-blue-400 hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {liabilities.map((liability, i) => (
          <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-gray-400">Name</label>
                <input
                  value={liability.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={liability.name ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="Liability name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Balance</label>
                <input
                  type="number"
                  value={liability.balance ?? ""}
                  onChange={(e) => updateField(i, "balance", e.target.value ? Number(e.target.value) : undefined)}
                  className={liability.balance != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Interest Rate</label>
                <input
                  type="number"
                  step="0.001"
                  value={liability.interestRate ?? ""}
                  onChange={(e) => updateField(i, "interestRate", e.target.value ? Number(e.target.value) : undefined)}
                  className={EMPTY_CLASS}
                  placeholder="0.05"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Monthly Payment</label>
                <input
                  type="number"
                  value={liability.monthlyPayment ?? ""}
                  onChange={(e) => updateField(i, "monthlyPayment", e.target.value ? Number(e.target.value) : undefined)}
                  className={EMPTY_CLASS}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Start</label>
                  <input
                    type="number"
                    value={liability.startYear ?? ""}
                    onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                    className={liability.startYear != null ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder={String(defaultStartYear)}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">End</label>
                  <input
                    type="number"
                    value={liability.endYear ?? ""}
                    onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                    className={liability.endYear != null ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder={String(defaultEndYear)}
                  />
                </div>
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-gray-500 hover:text-red-400"
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
