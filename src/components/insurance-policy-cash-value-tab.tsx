"use client";

import InsurancePolicyCashValueGrid, {
  type ScheduleRow,
} from "./insurance-policy-cash-value-grid";

interface InsurancePolicyCashValueTabProps {
  policyType: "term" | "whole" | "universal" | "variable";
  mode: "basic" | "free_form";
  schedule: ScheduleRow[];
  /** Fixed schedule range: plan start year → household second-to-die year. */
  scheduleStartYear: number;
  scheduleEndYear: number;
  onChangeMode: (mode: "basic" | "free_form") => void;
  onChangeSchedule: (rows: ScheduleRow[]) => void;
}

export default function InsurancePolicyCashValueTab({
  policyType,
  mode,
  schedule,
  scheduleStartYear,
  scheduleEndYear,
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
          in plan settings. Switch to free-form mode to set premium, income,
          cash value, and death benefit per year — every value you enter
          overrides the policy defaults for that year.
        </p>
      ) : (
        <InsurancePolicyCashValueGrid
          rows={schedule}
          startYear={scheduleStartYear}
          endYear={scheduleEndYear}
          onChange={onChangeSchedule}
        />
      )}
    </div>
  );
}
