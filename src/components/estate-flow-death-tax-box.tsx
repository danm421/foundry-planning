"use client";

import { useState } from "react";
import type { EstateTaxResult } from "@/engine/types";
import {
  DecedentTaxCalculation,
  inheritanceTaxOf,
  irdTaxOf,
} from "@/components/estate-tax-decedent-breakdown";
import { DisclosureButton } from "@/components/disclosure-button";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * The bottom of an Estate Flow death column: this death's projected tax —
 * federal, state and IRD income tax — expandable to the Estate Tax page's
 * full calculation for the same decedent and year.
 */
export function EstateFlowDeathTaxBox({
  tax,
  showDsueGenerated,
}: {
  tax: EstateTaxResult;
  showDsueGenerated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const stateInheritance = inheritanceTaxOf(tax);
  const lines = [
    { label: "Federal estate tax", amount: tax.federalEstateTax },
    { label: "State estate tax", amount: tax.stateEstateTax },
    ...(stateInheritance > 0
      ? [{ label: "State inheritance tax", amount: stateInheritance }]
      : []),
    { label: "Income tax (IRD)", amount: irdTaxOf(tax) },
  ];
  // Taxes only — the expanded calculation's "Total Taxes & Expenses" also
  // carries probate and administrative costs.
  const total = lines.reduce((s, line) => s + line.amount, 0);

  return (
    <section className="overflow-hidden rounded border border-hair bg-card-2 text-xs">
      <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)}>
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-2">
          Projected tax
        </span>
        <span className="tabular-nums font-semibold text-ink">{fmt.format(total)}</span>
      </DisclosureButton>
      <dl className="px-2 pb-1.5 pl-6">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3 py-0.5">
            <dt className="text-ink-3">{line.label}</dt>
            <dd className="tabular-nums text-ink-2">{fmt.format(line.amount)}</dd>
          </div>
        ))}
      </dl>
      {open && (
        <div className="border-t border-hair">
          <DecedentTaxCalculation tax={tax} showDsueGenerated={showDsueGenerated} dense />
        </div>
      )}
    </section>
  );
}
