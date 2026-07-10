"use client";

import { useState } from "react";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { fmtUsd } from "@/lib/tax-analysis/format";
import type { YearDetail } from "./tax-analysis-content";

type MoneyPath =
  | ["income", keyof TaxReturnFacts["income"]]
  | ["deductions", "deductionAmount" | "qbiDeduction" | "taxableIncome"]
  | ["tax", keyof TaxReturnFacts["tax"]]
  | ["payments", keyof TaxReturnFacts["payments"]]
  | ["carryovers", "capitalLossCarryover"];

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
      { label: "Child tax credit (19)", path: ["tax", "childTaxCredit"] },
      { label: "Education credits (Sch 3 ln 3)", path: ["tax", "educationCredits"] },
      { label: "Self-employment tax (Sch 2 ln 4)", path: ["tax", "seTax"] },
      { label: "NIIT (Sch 2 ln 12)", path: ["tax", "niit"] },
      { label: "Additional Medicare (Sch 2 ln 11)", path: ["tax", "additionalMedicareTax"] },
      { label: "Total tax (24)", path: ["tax", "totalTax"] },
    ],
  },
  {
    heading: "Payments",
    fields: [
      { label: "Withholding (25d)", path: ["payments", "withholding"] },
      { label: "Estimated payments (26)", path: ["payments", "estimatedPayments"] },
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

      <div className="rounded border border-hair bg-card p-3 text-sm text-ink-2">
        Filing status: <span className="font-medium">{facts.filingStatus ?? "unknown"}</span>
        {" · "}State: <span className="font-medium">{facts.residenceState ?? "—"}</span>
        {" · "}
        {facts.income.agi != null ? `AGI ${fmtUsd(facts.income.agi)}` : "AGI not extracted"}
      </div>

      {SECTIONS.map((section) => (
        <fieldset key={section.heading} className="rounded border border-hair bg-card p-4">
          <legend className="px-1 text-sm font-medium">{section.heading}</legend>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
            {section.fields.map((f) => (
              <label key={f.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-2">{f.label}</span>
                <input
                  type="number"
                  className="w-36 rounded border border-hair bg-transparent px-2 py-1 text-right tabular-nums"
                  value={get(f.path) ?? ""}
                  onChange={(e) =>
                    set(f.path, e.target.value === "" ? null : Number(e.target.value))
                  }
                />
              </label>
            ))}
          </div>
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
