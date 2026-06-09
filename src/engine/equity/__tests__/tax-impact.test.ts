import { describe, it, expect } from "vitest";
import type { TaxResult } from "../../../lib/tax/types";
import { diffEquityTaxImpact } from "../tax-impact";

type Flow = TaxResult["flow"];

/** Zero-filled flow with overrides — only the fields diffEquityTaxImpact reads matter. */
function flow(over: Partial<Flow>): Flow {
  return {
    aboveLineDeductions: 0, adjustedGrossIncome: 0, qbiDeduction: 0,
    belowLineDeductions: 0, taxableIncome: 0, incomeTaxBase: 0, regularTaxCalc: 0,
    amtCredit: 0, taxCredits: 0, regularFederalIncomeTax: 0, capitalGainsTax: 0,
    amtAdditional: 0, niit: 0, additionalMedicare: 0, fica: 0, stateTax: 0,
    totalFederalTax: 0, totalTax: 0, earlyWithdrawalPenalty: 0, ...over,
  };
}

describe("diffEquityTaxImpact", () => {
  it("maps each flow delta to the right column and sums the total", () => {
    const withEq = flow({
      regularFederalIncomeTax: 5000, amtAdditional: 800, capitalGainsTax: 3000,
      niit: 200, fica: 1500, additionalMedicare: 90, stateTax: 1200,
    });
    const withoutEq = flow({
      regularFederalIncomeTax: 1000, amtAdditional: 0, capitalGainsTax: 1000,
      niit: 0, fica: 0, additionalMedicare: 0, stateTax: 400,
    });
    const r = diffEquityTaxImpact(withEq, withoutEq, {
      ordinaryIncome: 60000, capitalGains: 10000, isoSpread: 5000,
    });
    expect(r.ordinaryIncome).toBe(60000);
    expect(r.capitalGains).toBe(10000);
    expect(r.isoSpread).toBe(5000);
    expect(r.fedIncomeTax).toBe((5000 - 1000) + (800 - 0)); // 4800
    expect(r.capGainsTax).toBe((3000 - 1000) + (200 - 0));   // 2200
    expect(r.payrollTax).toBe((1500 - 0) + (90 - 0));        // 1590
    expect(r.stateTax).toBe(1200 - 400);                     // 800
    expect(r.totalTax).toBe(4800 + 2200 + 1590 + 800);       // 9390
  });

  it("captures a pure bracket-push: cap-gains tax delta with zero options gains", () => {
    // Options realized NO capital gains, but their ordinary income pushed the
    // client's other LTCG into a higher tier → capGainsTax delta is positive.
    const r = diffEquityTaxImpact(
      flow({ regularFederalIncomeTax: 9000, capitalGainsTax: 6000 }),
      flow({ regularFederalIncomeTax: 2000, capitalGainsTax: 0 }),
      { ordinaryIncome: 80000, capitalGains: 0, isoSpread: 0 },
    );
    expect(r.capitalGains).toBe(0);
    expect(r.capGainsTax).toBe(6000);
    expect(r.fedIncomeTax).toBe(7000);
  });
});
