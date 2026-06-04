"use client";

import InsurancePolicyCashValueGrid, {
  type ScheduleRow,
} from "./insurance-policy-cash-value-grid";

interface InsurancePolicyCashValueTabProps {
  policyType: "term" | "whole" | "universal" | "variable";
  mode: "basic" | "free_form";
  schedule: ScheduleRow[];
  premiumScheduleMode: "off" | "scheduled";
  deathBenefitScheduleMode: "off" | "scheduled";
  incomeScheduleMode: "off" | "scheduled";
  onChangeMode: (mode: "basic" | "free_form") => void;
  onChangeSchedule: (rows: ScheduleRow[]) => void;
  onChangePremiumScheduleMode: (mode: "off" | "scheduled") => void;
  onChangeDeathBenefitScheduleMode: (mode: "off" | "scheduled") => void;
  onChangeIncomeScheduleMode: (mode: "off" | "scheduled") => void;
}

export default function InsurancePolicyCashValueTab({
  policyType,
  mode,
  schedule,
  premiumScheduleMode,
  deathBenefitScheduleMode,
  incomeScheduleMode,
  onChangeMode,
  onChangeSchedule,
  onChangePremiumScheduleMode,
  onChangeDeathBenefitScheduleMode,
  onChangeIncomeScheduleMode,
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

  const anyOverrideOn =
    mode === "free_form" ||
    premiumScheduleMode === "scheduled" ||
    deathBenefitScheduleMode === "scheduled" ||
    incomeScheduleMode === "scheduled";

  function handleCsvPasted(rows: ScheduleRow[]) {
    // Turn on each mode for any column that has at least one non-empty value.
    if (rows.some((r) => r.premiumAmount != null)) {
      onChangePremiumScheduleMode("scheduled");
    }
    if (rows.some((r) => r.deathBenefit != null)) {
      onChangeDeathBenefitScheduleMode("scheduled");
    }
    if (rows.some((r) => r.income != null)) {
      onChangeIncomeScheduleMode("scheduled");
    }
    if (rows.some((r) => r.cashValue != null)) {
      onChangeMode("free_form");
    }
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

      {mode === "basic" && !anyOverrideOn && (
        <p className="text-xs text-ink-4">
          Cash value grows at the default life-insurance growth rate configured
          in plan settings. Switch to free-form mode if you need to specify
          exact values per year.
        </p>
      )}

      {/* Per-column override checkboxes */}
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink-3">
          Additional per-year overrides
        </legend>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={premiumScheduleMode === "scheduled"}
              onChange={(e) =>
                onChangePremiumScheduleMode(e.target.checked ? "scheduled" : "off")
              }
              className="rounded"
            />
            Override premium by year
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={deathBenefitScheduleMode === "scheduled"}
              onChange={(e) =>
                onChangeDeathBenefitScheduleMode(e.target.checked ? "scheduled" : "off")
              }
              className="rounded"
            />
            Override death benefit by year
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={incomeScheduleMode === "scheduled"}
              onChange={(e) =>
                onChangeIncomeScheduleMode(e.target.checked ? "scheduled" : "off")
              }
              className="rounded"
            />
            Override income by year
          </label>
        </div>
      </fieldset>

      {anyOverrideOn && (
        <InsurancePolicyCashValueGrid
          rows={schedule}
          onChange={onChangeSchedule}
          onCsvPasted={handleCsvPasted}
        />
      )}
    </div>
  );
}
