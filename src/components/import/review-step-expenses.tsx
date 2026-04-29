"use client";

import type { ExtractedExpense, ExpenseType } from "@/lib/extraction/types";

const EXPENSE_TYPE_OPTIONS: { value: ExpenseType; label: string }[] = [
  { value: "living", label: "Living" },
  { value: "other", label: "Other" },
  { value: "insurance", label: "Insurance" },
];

interface ReviewStepExpensesProps {
  expenses: ExtractedExpense[];
  onChange: (expenses: ExtractedExpense[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-accent focus:outline-none";

export default function ReviewStepExpenses({
  expenses,
  onChange,
  defaultStartYear,
  defaultEndYear,
}: ReviewStepExpensesProps) {
  const updateField = (index: number, field: keyof ExtractedExpense, value: unknown) => {
    const updated = expenses.map((exp, i) =>
      i === index ? { ...exp, [field]: value } : exp
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([
      ...expenses,
      { name: "", type: "living", startYear: defaultStartYear, endYear: defaultEndYear },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(expenses.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Expenses ({expenses.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-accent hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {expenses.map((expense, i) => (
          <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-gray-300">Name</label>
                <input
                  value={expense.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={expense.name ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="Expense name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Type</label>
                <select
                  value={expense.type ?? ""}
                  onChange={(e) => updateField(i, "type", e.target.value || undefined)}
                  className={expense.type ? SELECT_CLASS : `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`}
                >
                  <option value="">Select...</option>
                  {EXPENSE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Annual Amount</label>
                <input
                  type="number"
                  value={expense.annualAmount ?? ""}
                  onChange={(e) => updateField(i, "annualAmount", e.target.value ? Number(e.target.value) : undefined)}
                  className={expense.annualAmount != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Start Year</label>
                <input
                  type="number"
                  value={expense.startYear ?? ""}
                  onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={expense.startYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultStartYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">End Year</label>
                <input
                  type="number"
                  value={expense.endYear ?? ""}
                  onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={expense.endYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultEndYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-300">Growth Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={expense.growthRate ?? ""}
                  onChange={(e) => updateField(i, "growthRate", e.target.value ? Number(e.target.value) : undefined)}
                  className={EMPTY_CLASS}
                  placeholder="0.03"
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
