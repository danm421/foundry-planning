"use client";

import type { ExtractedIncome, IncomeType } from "@/lib/extraction/types";
import type { Annotated } from "@/lib/imports/types";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { inputClassName, selectClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import SourceBadge from "./source-badge";

// The file's warn flag pair. Layered on top of CurrencyInput/PercentInput's
// own inputClassName baseline to flag fields the AI didn't extract, and reused
// on the superseded-row badge (which supplies its own `border` width).
const TINT_EMPTY = "bg-warn/10 border-warn/40";

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
  { value: "spouse", label: CO_CLIENT_LABEL },
  { value: "joint", label: "Joint" },
];

interface ReviewStepIncomesProps {
  /**
   * Annotated, not bare `ExtractedIncome`: a row the reconciler judged a
   * duplicate measurement of another row's earnings carries `reconciliation`,
   * and the bare type cannot see it. Both call sites already hold annotated
   * rows.
   */
  incomes: Annotated<ExtractedIncome>[];
  onChange: (incomes: Annotated<ExtractedIncome>[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}

const EMPTY_CLASS = `${inputClassName} ${TINT_EMPTY}`;

export default function ReviewStepIncomes({
  incomes,
  onChange,
  defaultStartYear,
  defaultEndYear,
  milestones,
  clientFirstName,
  spouseFirstName,
}: ReviewStepIncomesProps) {
  const updateField = (index: number, field: keyof ExtractedIncome, value: unknown) => {
    const updated = incomes.map((inc, i) =>
      i === index ? { ...inc, [field]: value } : inc
    );
    onChange(updated);
  };

  const updateTiming = (
    index: number,
    side: "start" | "end",
    year: number,
    ref: YearRef | null,
  ) => {
    const yearField = side === "start" ? "startYear" : "endYear";
    const refField = side === "start" ? "startYearRef" : "endYearRef";
    const updated = incomes.map((inc, i) =>
      i === index ? { ...inc, [yearField]: year, [refField]: ref ?? undefined } : inc,
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
        <h3 className="text-lg font-medium text-ink">
          Income ({incomes.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-card-2 px-3 py-1.5 text-sm text-accent hover:bg-card-hover"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {incomes.map((income, i) => (
          <div
            key={i}
            // A superseded row is recessed a step below its peers' bg-card-2
            // and hairlined warn, never dropped: commitIncomes skips it, so the
            // advisor has to be able to see the row and read why. The fields
            // below stay editable.
            className={`rounded-lg border p-3 ${
              income.reconciliation
                ? "border-warn/50 bg-card"
                : "border-hair bg-card-2"
            }`}
          >
            {income.reconciliation && (
              <div className="mb-2.5 border-b border-warn/30 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {income.name && (
                    <span className="text-sm font-medium text-ink">{income.name}</span>
                  )}
                  <span
                    className={`rounded border ${TINT_EMPTY} px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-warn`}
                  >
                    Won&apos;t be imported
                  </span>
                </div>
                {income.reconciliation.reason && (
                  <p className="mt-1 max-w-prose text-xs leading-snug text-ink-3">
                    {income.reconciliation.reason}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className={fieldLabelClassName}>Name</label>
                <input
                  value={income.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={income.name ? inputClassName : EMPTY_CLASS}
                  placeholder="Income source name"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Type</label>
                <select
                  value={income.type ?? ""}
                  onChange={(e) => updateField(i, "type", e.target.value || undefined)}
                  className={income.type ? selectClassName : `${selectClassName} ${TINT_EMPTY}`}
                >
                  <option value="">Select...</option>
                  {INCOME_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabelClassName}>Annual Amount</label>
                <CurrencyInput
                  value={income.annualAmount != null ? String(income.annualAmount) : ""}
                  onChange={(raw) => updateField(i, "annualAmount", raw === "" ? undefined : Number(raw))}
                  className={income.annualAmount != null ? "" : TINT_EMPTY}
                  placeholder="0"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Owner</label>
                <select
                  value={income.owner ?? "client"}
                  onChange={(e) => updateField(i, "owner", e.target.value)}
                  className={selectClassName}
                >
                  {OWNER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                {milestones ? (
                  <MilestoneYearPicker
                    name={`inc-start-${i}`}
                    id={`inc-start-${i}`}
                    value={income.startYear ?? defaultStartYear}
                    yearRef={income.startYearRef ?? null}
                    milestones={milestones}
                    showSSRefs={false}
                    onChange={(yr, ref) => updateTiming(i, "start", yr, ref)}
                    label="Start Year"
                    clientFirstName={clientFirstName}
                    spouseFirstName={spouseFirstName}
                    position="start"
                  />
                ) : (
                  <>
                    <label className={fieldLabelClassName}>Start Year</label>
                    <input
                      type="number"
                      value={income.startYear ?? ""}
                      onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                      className={income.startYear != null ? inputClassName : EMPTY_CLASS}
                      placeholder={String(defaultStartYear)}
                    />
                  </>
                )}
              </div>
              <div>
                {milestones ? (
                  <MilestoneYearPicker
                    name={`inc-end-${i}`}
                    id={`inc-end-${i}`}
                    value={income.endYear ?? defaultEndYear}
                    yearRef={income.endYearRef ?? null}
                    milestones={milestones}
                    showSSRefs={false}
                    onChange={(yr, ref) => updateTiming(i, "end", yr, ref)}
                    label="End Year"
                    clientFirstName={clientFirstName}
                    spouseFirstName={spouseFirstName}
                    startYearForDuration={income.startYear ?? defaultStartYear}
                    position="end"
                  />
                ) : (
                  <>
                    <label className={fieldLabelClassName}>End Year</label>
                    <input
                      type="number"
                      value={income.endYear ?? ""}
                      onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                      className={income.endYear != null ? inputClassName : EMPTY_CLASS}
                      placeholder={String(defaultEndYear)}
                    />
                  </>
                )}
              </div>
              <div>
                <label className={fieldLabelClassName}>Growth Rate</label>
                <PercentInput
                  value={income.growthRate != null ? (income.growthRate * 100).toFixed(2) : ""}
                  onChange={(raw) => updateField(i, "growthRate", raw === "" ? undefined : Number(raw) / 100)}
                  className={TINT_EMPTY}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end gap-2">
                <SourceBadge row={income} className="pb-1" />
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
