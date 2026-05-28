"use client";

import type { CashFlowPageOptions } from "@/lib/presentations/types";

interface Props {
  value: CashFlowPageOptions;
  onChange: (next: CashFlowPageOptions) => void;
}

const CURRENT_YEAR = new Date().getFullYear();

export function CashFlowOptionsControl({ value, onChange }: Props) {
  const isCustom = typeof value.range === "object";
  const startYear = isCustom ? (value.range as { startYear: number }).startYear : CURRENT_YEAR;
  const endYear = isCustom ? (value.range as { endYear: number }).endYear : CURRENT_YEAR + 30;

  return (
    <div className="space-y-2 text-sm">
      <fieldset className="space-y-1">
        <legend className="sr-only">Range</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={value.range === "retirement"}
            onChange={() => onChange({ ...value, range: "retirement" })}
          />
          <span>Retirement only</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={value.range === "lifetime"}
            onChange={() => onChange({ ...value, range: "lifetime" })}
          />
          <span>Lifetime</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={isCustom}
            onChange={() => onChange({ ...value, range: { startYear, endYear } })}
          />
          <span>Custom range</span>
        </label>
      </fieldset>
      {isCustom && (
        <div className="flex items-center gap-3 pl-6">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Start year</span>
            <input
              type="number"
              aria-label="Start year"
              className="w-24 rounded border px-2 py-1"
              value={startYear}
              onChange={(e) =>
                onChange({
                  ...value,
                  range: { startYear: Number(e.target.value), endYear },
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">End year</span>
            <input
              type="number"
              aria-label="End year"
              className="w-24 rounded border px-2 py-1"
              value={endYear}
              onChange={(e) =>
                onChange({
                  ...value,
                  range: { startYear, endYear: Number(e.target.value) },
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
