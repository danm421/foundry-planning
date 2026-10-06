"use client";

import { useState } from "react";
import type { EstateTaxResult } from "@/engine/types";
import {
  DecedentTaxCalculation,
  inheritanceTaxOf,
  irdTaxOf,
} from "@/components/estate-tax-decedent-breakdown";
import { ShareBandButton } from "@/components/estate-flow-share-band";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * The bottom of an Estate Flow death column: this death's projected tax —
 * federal, state and IRD income tax — banded to its share of the estate like
 * the recipient boxes above it, and expandable to the Estate Tax page's full
 * calculation for the same decedent and year.
 */
export function EstateFlowDeathTaxBox({
  tax,
  estateAtDeath,
  showDsueGenerated,
}: {
  tax: EstateTaxResult;
  /** The column's gross estate — what the tax band is a share of. */
  estateAtDeath: number;
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
    <section className="overflow-hidden rounded-lg border border-hair text-xs">
      <ShareBandButton
        open={open}
        onToggle={() => setOpen((o) => !o)}
        share={estateAtDeath > 0 ? total / estateAtDeath : 0}
        hue="var(--share-tax)"
        shareOf="the estate"
        label="Projected tax"
        figure={fmt.format(total)}
      />
      <dl className="pb-2 pl-[30px] pr-3 pt-1.5">
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
