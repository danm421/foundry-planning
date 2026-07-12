"use client";

import { useState } from "react";
import type { TaxReturnFacts, TaxReturnFilingStatus } from "@/lib/schemas/tax-return-facts";
import { fmtUsd } from "@/lib/tax-analysis/format";
import { StateSelect } from "@/components/state-select";
import { selectClassName, selectBaseClassName, inputBaseClassName } from "@/components/forms/input-styles";
import { MoneyField } from "./money-field";
import type { YearDetail } from "./tax-analysis-content";

const FILING_STATUS_OPTIONS: Array<{ value: TaxReturnFilingStatus; label: string }> = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married filing jointly" },
  { value: "married_separate", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
];

type MoneyPath =
  | ["income", keyof TaxReturnFacts["income"]]
  | ["deductions", "deductionAmount" | "qbiDeduction" | "taxableIncome"]
  | ["tax", keyof TaxReturnFacts["tax"]]
  | ["payments", keyof TaxReturnFacts["payments"]]
  | ["carryovers", "capitalLossCarryover"];

type ScheduleAFacts = NonNullable<TaxReturnFacts["deductions"]["scheduleA"]>;
type ScheduleAKey = keyof ScheduleAFacts;

const EMPTY_SCHEDULE_A: ScheduleAFacts = {
  saltPaid: null, saltDeducted: null, mortgageInterest: null,
  charitableCash: null, charitableNonCash: null, medical: null,
};

const SCHEDULE_A_FIELDS: Array<{ label: string; key: ScheduleAKey }> = [
  { label: "SALT paid (Sch A 5d)", key: "saltPaid" },
  { label: "SALT deducted — after cap (Sch A 7)", key: "saltDeducted" },
  { label: "Mortgage interest (Sch A 8e)", key: "mortgageInterest" },
  { label: "Charitable — cash (Sch A 11)", key: "charitableCash" },
  { label: "Charitable — non-cash (Sch A 12)", key: "charitableNonCash" },
  { label: "Medical — after AGI floor (Sch A 4)", key: "medical" },
];

const SECTIONS: Array<{ heading: string; fields: Array<{ label: string; path: MoneyPath }> }> = [
  {
    heading: "Income",
    fields: [
      { label: "Wages (1a)", path: ["income", "wages"] },
      { label: "Taxable interest (2b)", path: ["income", "taxableInterest"] },
      { label: "Tax-exempt interest (2a)", path: ["income", "taxExemptInterest"] },
      { label: "Ordinary dividends (3b)", path: ["income", "ordinaryDividends"] },
      { label: "Qualified dividends (3a)", path: ["income", "qualifiedDividends"] },
      { label: "IRA distributions — gross (4a)", path: ["income", "iraDistributionsGross"] },
      { label: "IRA distributions — taxable (4b)", path: ["income", "iraDistributionsTaxable"] },
      { label: "Pensions — gross (5a)", path: ["income", "pensionsGross"] },
      { label: "Pensions — taxable (5b)", path: ["income", "pensionsTaxable"] },
      { label: "Social Security — gross (6a)", path: ["income", "ssBenefitsGross"] },
      { label: "Social Security — taxable (6b)", path: ["income", "ssBenefitsTaxable"] },
      { label: "Capital gain/loss (7)", path: ["income", "capitalGainOrLoss"] },
      { label: "Net long-term gain (Sch D 15)", path: ["income", "netLongTermGain"] },
      { label: "Net short-term gain (Sch D 7)", path: ["income", "netShortTermGain"] },
      { label: "Business income (Sch 1 ln 3)", path: ["income", "scheduleCNet"] },
      { label: "Rental/passthrough (Sch 1 ln 5)", path: ["income", "scheduleENet"] },
      { label: "Unemployment (Sch 1 ln 7)", path: ["income", "unemployment"] },
      { label: "Other income (Sch 1 ln 9)", path: ["income", "otherIncome"] },
      { label: "Total income (9)", path: ["income", "totalIncome"] },
      { label: "Adjustments (10)", path: ["income", "adjustmentsToIncome"] },
      { label: "AGI (11)", path: ["income", "agi"] },
    ],
  },
  {
    heading: "Deductions",
    fields: [
      { label: "Deduction amount (12)", path: ["deductions", "deductionAmount"] },
      { label: "QBI deduction (13)", path: ["deductions", "qbiDeduction"] },
      { label: "Taxable income (15)", path: ["deductions", "taxableIncome"] },
    ],
  },
  {
    heading: "Tax & credits",
    fields: [
      { label: "Tax before credits (16)", path: ["tax", "taxBeforeCredits"] },
      { label: "AMT (Sch 2 ln 1)", path: ["tax", "amt"] },
      { label: "Excess APTC repayment (Sch 2 ln 2)", path: ["tax", "excessAptcRepayment"] },
      { label: "Child tax credit (19)", path: ["tax", "childTaxCredit"] },
      { label: "Education credits (Sch 3 ln 3)", path: ["tax", "educationCredits"] },
      { label: "Foreign tax credit (Sch 3 ln 1)", path: ["tax", "foreignTaxCredit"] },
      { label: "Energy credits (Sch 3 ln 5a/5b)", path: ["tax", "energyCredits"] },
      { label: "Other credits (Sch 3)", path: ["tax", "otherCredits"] },
      { label: "Self-employment tax (Sch 2 ln 4)", path: ["tax", "seTax"] },
      { label: "NIIT (Sch 2 ln 12)", path: ["tax", "niit"] },
      { label: "Additional Medicare (Sch 2 ln 11)", path: ["tax", "additionalMedicareTax"] },
      { label: "Other taxes (Sch 2)", path: ["tax", "otherTaxes"] },
      { label: "Total tax (24)", path: ["tax", "totalTax"] },
    ],
  },
  {
    heading: "Payments",
    fields: [
      { label: "Withholding (25d)", path: ["payments", "withholding"] },
      { label: "Estimated payments (26)", path: ["payments", "estimatedPayments"] },
      { label: "Other payments (Sch 3 ln 13)", path: ["payments", "otherPayments"] },
      { label: "Refund (34)", path: ["payments", "refund"] },
      { label: "Amount owed (37)", path: ["payments", "amountOwed"] },
      { label: "Capital-loss carryover", path: ["carryovers", "capitalLossCarryover"] },
    ],
  },
];

export function FactsReviewForm({
  clientId,
  detail,
  onSaved,
}: {
  clientId: string;
  detail: YearDetail;
  onSaved: () => void;
}) {
  const [facts, setFacts] = useState<TaxReturnFacts>(detail.facts!);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function get(path: MoneyPath): number | null {
    const [section, key] = path;
    return (facts[section] as Record<string, number | null>)[key];
  }

  function set(path: MoneyPath, value: number | null) {
    const [section, key] = path;
    setFacts((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
  }

  function setFilingStatus(value: string) {
    setFacts((prev) => ({
      ...prev,
      filingStatus: value === "" ? null : (value as TaxReturnFilingStatus),
    }));
  }

  function setResidenceState(value: string) {
    setFacts((prev) => ({ ...prev, residenceState: value === "" ? null : value }));
  }

  function setCount(key: "dependentsUnder17" | "dependents17to23", raw: string) {
    let n: number | null = null;
    if (raw !== "") {
      const parsed = Math.trunc(Number(raw));
      n = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    setFacts((prev) => ({ ...prev, [key]: n }));
  }

  function setDeductionTaken(value: string) {
    setFacts((prev) => ({
      ...prev,
      deductions: {
        ...prev.deductions,
        deductionTaken: value === "" ? null : (value as "standard" | "itemized"),
      },
    }));
  }

  function setScheduleA(key: ScheduleAKey, v: number | null) {
    setFacts((prev) => ({
      ...prev,
      deductions: {
        ...prev.deductions,
        scheduleA: { ...(prev.deductions.scheduleA ?? EMPTY_SCHEDULE_A), [key]: v },
      },
    }));
  }

  function addScheduleA() {
    setFacts((prev) => ({
      ...prev,
      deductions: { ...prev.deductions, scheduleA: { ...EMPTY_SCHEDULE_A } },
    }));
  }

  async function save(markReady: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tax-returns/${detail.taxYear}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facts, markReady }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {detail.warnings.length > 0 && (
        <div className="rounded border border-hair bg-card p-3 text-sm text-ink-2">
          <p className="mb-1 font-medium">Extraction notes</p>
          <ul className="list-inside list-disc">
            {detail.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded border border-hair bg-card p-3">
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="facts-filing-status" className="text-ink-2">
              Filing status
            </label>
            <select
              id="facts-filing-status"
              className={selectClassName}
              value={facts.filingStatus ?? ""}
              onChange={(e) => setFilingStatus(e.target.value)}
            >
              <option value="">Select filing status…</option>
              {FILING_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="facts-residence-state" className="text-ink-2">
              Residence state
            </label>
            <StateSelect
              id="facts-residence-state"
              name="residenceState"
              value={facts.residenceState ?? ""}
              onChange={setResidenceState}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="facts-dependents-u17" className="text-ink-2">
              Dependents under 17
            </label>
            <input
              id="facts-dependents-u17"
              type="number"
              min={0}
              step={1}
              className={`${inputBaseClassName} w-24 text-right tabular-nums`}
              value={facts.dependentsUnder17 ?? ""}
              onChange={(e) => setCount("dependentsUnder17", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="facts-dependents-17-23" className="text-ink-2">
              Dependents 17–23
            </label>
            <input
              id="facts-dependents-17-23"
              type="number"
              min={0}
              step={1}
              className={`${inputBaseClassName} w-24 text-right tabular-nums`}
              value={facts.dependents17to23 ?? ""}
              onChange={(e) => setCount("dependents17to23", e.target.value)}
            />
          </div>

          <div className="flex flex-col justify-end text-ink-2">
            {facts.income.agi != null ? `AGI ${fmtUsd(facts.income.agi)}` : "AGI not extracted"}
          </div>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <fieldset key={section.heading} className="rounded border border-hair bg-card p-4">
          <legend className="px-1 text-sm font-medium">{section.heading}</legend>

          {section.heading === "Deductions" && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <label htmlFor="facts-deduction-taken" className="text-ink-2">
                Deduction taken
              </label>
              <select
                id="facts-deduction-taken"
                className={`${selectBaseClassName} w-36`}
                value={facts.deductions.deductionTaken ?? ""}
                onChange={(e) => setDeductionTaken(e.target.value)}
              >
                <option value="">Not set</option>
                <option value="standard">Standard</option>
                <option value="itemized">Itemized</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
            {section.fields.map((f) => (
              <label key={f.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-2">{f.label}</span>
                <MoneyField value={get(f.path)} onChange={(v) => set(f.path, v)} />
              </label>
            ))}
          </div>

          {section.heading === "Deductions" && facts.deductions.scheduleA && (
            <div className="mt-3 border-l-2 border-hair pl-4">
              <p className="mb-2 text-xs font-medium uppercase text-ink-3">Schedule A breakdown</p>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
                {SCHEDULE_A_FIELDS.map((f) => (
                  <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-2">{f.label}</span>
                    <MoneyField
                      value={facts.deductions.scheduleA![f.key]}
                      onChange={(v) => setScheduleA(f.key, v)}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {section.heading === "Deductions" &&
            !facts.deductions.scheduleA &&
            facts.deductions.deductionTaken === "itemized" && (
              <button
                type="button"
                className="mt-3 rounded border border-hair px-3 py-1.5 text-sm text-ink-2"
                onClick={addScheduleA}
              >
                Add Schedule A breakdown
              </button>
            )}
        </fieldset>
      ))}

      {error && <p className="text-sm text-crit">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" className="rounded border border-hair px-4 py-2 text-sm" disabled={saving} onClick={() => save(false)}>
          Save draft
        </button>
        <button type="button" className="btn-primary px-4 py-2 text-sm font-medium" disabled={saving} onClick={() => save(true)}>
          Looks right — generate report
        </button>
      </div>
    </div>
  );
}
