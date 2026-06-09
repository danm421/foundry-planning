import type { TaxResult } from "../../lib/tax/types";

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
