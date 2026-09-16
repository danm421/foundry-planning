"use client";

import type { ExtractedLiability } from "@/lib/extraction/types";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import SourceBadge from "./source-badge";

// Layered on top of CurrencyInput/PercentInput's own inputClassName baseline
// to flag fields the AI didn't extract.
const TINT_EMPTY = "bg-warn/10 border-warn/40";

interface ReviewStepLiabilitiesProps {
  liabilities: ExtractedLiability[];
  onChange: (liabilities: ExtractedLiability[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
}

const EMPTY_CLASS = `${inputClassName} ${TINT_EMPTY}`;

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
        <h3 className="text-lg font-medium text-ink">
          Liabilities ({liabilities.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-card-2 px-3 py-1.5 text-sm text-accent hover:bg-card-hover"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {liabilities.map((liability, i) => (
          <div key={i} className="rounded-lg border border-hair bg-card-2 p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className={fieldLabelClassName}>Name</label>
                <input
                  value={liability.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={liability.name ? inputClassName : EMPTY_CLASS}
                  placeholder="Liability name"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Balance</label>
                <CurrencyInput
                  value={liability.balance != null ? String(liability.balance) : ""}
                  onChange={(raw) => updateField(i, "balance", raw === "" ? undefined : Number(raw))}
                  className={liability.balance != null ? "" : TINT_EMPTY}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Interest Rate</label>
                <PercentInput
                  value={liability.interestRate != null ? (liability.interestRate * 100).toFixed(3) : ""}
                  onChange={(raw) => updateField(i, "interestRate", raw === "" ? undefined : Number(raw) / 100)}
                  className={liability.interestRate != null ? "" : TINT_EMPTY}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Monthly Payment</label>
                <CurrencyInput
                  value={liability.monthlyPayment != null ? String(liability.monthlyPayment) : ""}
                  onChange={(raw) => updateField(i, "monthlyPayment", raw === "" ? undefined : Number(raw))}
                  className={liability.monthlyPayment != null ? "" : TINT_EMPTY}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className={fieldLabelClassName}>Start</label>
                  <input
                    type="number"
                    value={liability.startYear ?? ""}
                    onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                    className={liability.startYear != null ? inputClassName : EMPTY_CLASS}
                    placeholder={String(defaultStartYear)}
                  />
                </div>
                <div className="flex-1">
                  <label className={fieldLabelClassName}>End</label>
                  <input
                    type="number"
                    value={liability.endYear ?? ""}
                    onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                    className={liability.endYear != null ? inputClassName : EMPTY_CLASS}
                    placeholder={String(defaultEndYear)}
                  />
                </div>
                <SourceBadge row={liability} className="pb-1" />
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-white hover:text-white"
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
