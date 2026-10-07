import type { EstateTaxResult } from "@/engine/types";

// Death taxes the engine carries outside `totalTaxesAndExpenses`. Kept free of
// React so server code (the presentation PDF's page data) can read them too.

export function inheritanceTaxOf(r: EstateTaxResult): number {
  return r.stateInheritanceTax && !r.stateInheritanceTax.inactive
    ? r.stateInheritanceTax.totalTax
    : 0;
}

export function irdTaxOf(r: EstateTaxResult): number {
  return (r.drainAttributions ?? [])
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((s, a) => s + a.amount, 0);
}
