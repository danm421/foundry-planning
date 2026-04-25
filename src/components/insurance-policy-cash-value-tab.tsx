"use client";

import InsurancePolicyCashValueGrid from "./insurance-policy-cash-value-grid";

interface InsurancePolicyCashValueTabProps {
  policyType: "term" | "whole" | "universal" | "variable";
  mode: "basic" | "free_form";
  schedule: { year: number; cashValue: number }[];
  onChangeMode: (mode: "basic" | "free_form") => void;
  onChangeSchedule: (rows: { year: number; cashValue: number }[]) => void;
}

export default function InsurancePolicyCashValueTab({
  policyType,
  mode,
  schedule,
  onChangeMode,
  onChangeSchedule,
}: InsurancePolicyCashValueTabProps) {
  if (policyType === "term") {
    return (
      <div className="py-6">
        <div className="rounded-md border border-hair bg-card-2 px-4 py-3 text-sm text-ink-3">
          Term policies have no cash value.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink-3">
          Cash value growth
        </legend>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input
              type="radio"
              name="cashValueGrowthMode"
              value="basic"
              checked={mode === "basic"}
              onChange={() => onChangeMode("basic")}
              className="mt-1"
            />
            <span>
              <span className="block">Basic (default growth rate)</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input
              type="radio"
              name="cashValueGrowthMode"
              value="free_form"
              checked={mode === "free_form"}
              onChange={() => onChangeMode("free_form")}
              className="mt-1"
            />
            <span>
              <span className="block">Free-form (year-by-year schedule)</span>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === "basic" ? (
        <p className="text-xs text-ink-4">
          Cash value grows at the default life-insurance growth rate configured
          in plan settings. Switch to free-form mode if you need to specify
          exact values per year.
        </p>
      ) : (
        <InsurancePolicyCashValueGrid
          rows={schedule}
          onChange={onChangeSchedule}
        />
      )}
    </div>
  );
}
