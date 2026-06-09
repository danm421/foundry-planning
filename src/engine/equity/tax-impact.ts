import type { TaxResult } from "../../lib/tax/types";
import type { ProjectionYear } from "../types";

/** Additional tax attributable to a year's equity-comp events (counterfactual delta). */
export interface EquityTaxImpact {
  ordinaryIncome: number; // RSU vest FMV + NQSO spread + disqualifying-ISO OI
  capitalGains: number;   // LT + ST gains realized on sold option shares
  isoSpread: number;      // AMT preference (informational)
  fedIncomeTax: number;   // Δ regular federal income tax + Δ AMT
  capGainsTax: number;    // Δ federal cap-gains tax + Δ NIIT (incl. bracket push)
  payrollTax: number;     // Δ FICA: OASDI + Medicare + 0.9% additional Medicare
  stateTax: number;       // Δ state income tax
  totalTax: number;       // fedIncomeTax + capGainsTax + payrollTax + stateTax
}

/**
 * Decompose with-equity vs without-equity tax flows into the report's columns.
 * The capGains column intentionally includes the bracket-push effect on the
 * client's other gains — it falls out of the cap-gains-tax delta automatically.
 */
export function diffEquityTaxImpact(
  withFlow: TaxResult["flow"],
  withoutFlow: TaxResult["flow"],
  equity: { ordinaryIncome: number; capitalGains: number; isoSpread: number },
): EquityTaxImpact {
  const fedIncomeTax =
    (withFlow.regularFederalIncomeTax - withoutFlow.regularFederalIncomeTax) +
    (withFlow.amtAdditional - withoutFlow.amtAdditional);
  const capGainsTax =
    (withFlow.capitalGainsTax - withoutFlow.capitalGainsTax) +
    (withFlow.niit - withoutFlow.niit);
  const payrollTax =
    (withFlow.fica - withoutFlow.fica) +
    (withFlow.additionalMedicare - withoutFlow.additionalMedicare);
  const stateTax = withFlow.stateTax - withoutFlow.stateTax;
  return {
    ordinaryIncome: equity.ordinaryIncome,
    capitalGains: equity.capitalGains,
    isoSpread: equity.isoSpread,
    fedIncomeTax,
    capGainsTax,
    payrollTax,
    stateTax,
    totalTax: fedIncomeTax + capGainsTax + payrollTax + stateTax,
  };
}

export interface EquityTaxImpactRow {
  year: number;
  ordinaryIncome: number;
  isoSpread: number;
  capitalGains: number;
  totalIncome: number; // ordinaryIncome + capitalGains
  fedIncomeTax: number;
  capGainsTax: number;
  payrollTax: number;
  stateTax: number;
  totalTax: number;
  netIncome: number;   // totalIncome − totalTax
}

export interface EquityTaxImpactModel {
  rows: EquityTaxImpactRow[]; // one per year with equity activity
  totals: EquityTaxImpactRow; // straight column sums (year = 0)
  hasActivity: boolean;
}

const EMPTY_TOTALS: EquityTaxImpactRow = {
  year: 0, ordinaryIncome: 0, isoSpread: 0, capitalGains: 0, totalIncome: 0,
  fedIncomeTax: 0, capGainsTax: 0, payrollTax: 0, stateTax: 0, totalTax: 0, netIncome: 0,
};

// Every numeric column summed into the totals row (everything but `year`).
const SUM_KEYS = [
  "ordinaryIncome", "isoSpread", "capitalGains", "totalIncome",
  "fedIncomeTax", "capGainsTax", "payrollTax", "stateTax", "totalTax", "netIncome",
] as const satisfies readonly (keyof EquityTaxImpactRow)[];

export function buildEquityTaxImpact(years: ProjectionYear[]): EquityTaxImpactModel {
  const rows: EquityTaxImpactRow[] = [];
  for (const y of years) {
    const e = y.equityTaxImpact;
    if (!e) continue;
    const totalIncome = e.ordinaryIncome + e.capitalGains;
    rows.push({
      year: y.year,
      ordinaryIncome: e.ordinaryIncome,
      isoSpread: e.isoSpread,
      capitalGains: e.capitalGains,
      totalIncome,
      fedIncomeTax: e.fedIncomeTax,
      capGainsTax: e.capGainsTax,
      payrollTax: e.payrollTax,
      stateTax: e.stateTax,
      totalTax: e.totalTax,
      netIncome: totalIncome - e.totalTax,
    });
  }
  const totals: EquityTaxImpactRow = { ...EMPTY_TOTALS };
  for (const r of rows) {
    for (const k of SUM_KEYS) totals[k] += r[k];
  }
  return { rows, totals, hasActivity: rows.length > 0 };
}
