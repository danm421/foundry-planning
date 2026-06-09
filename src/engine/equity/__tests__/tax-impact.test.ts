import { describe, it, expect } from "vitest";
import type { TaxResult } from "../../../lib/tax/types";
import { diffEquityTaxImpact, buildEquityTaxImpact } from "../tax-impact";
import type { ProjectionYear } from "../../types";

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

function projYear(year: number, impact?: Partial<import("../tax-impact").EquityTaxImpact>): ProjectionYear {
  const e = impact && {
    ordinaryIncome: 0, capitalGains: 0, isoSpread: 0, fedIncomeTax: 0,
    capGainsTax: 0, payrollTax: 0, stateTax: 0, totalTax: 0, ...impact,
  };
  // Only the fields buildEquityTaxImpact reads matter; cast the partial year.
  return { year, equityTaxImpact: e } as unknown as ProjectionYear;
}

describe("buildEquityTaxImpact", () => {
  it("emits one row per equity-active year, skips inactive years, sums totals", () => {
    const years = [
      projYear(2026), // no equityTaxImpact → skipped
      projYear(2027, { ordinaryIncome: 100, capitalGains: 0, fedIncomeTax: 20, payrollTax: 8, stateTax: 5, totalTax: 33 }),
      projYear(2028, { ordinaryIncome: 0, capitalGains: 200, capGainsTax: 30, stateTax: 10, totalTax: 40 }),
    ];
    const m = buildEquityTaxImpact(years);
    expect(m.hasActivity).toBe(true);
    expect(m.rows.map((r) => r.year)).toEqual([2027, 2028]);
    // 2027 row: totalIncome = 100 + 0; netIncome = 100 − 33
    expect(m.rows[0].totalIncome).toBe(100);
    expect(m.rows[0].netIncome).toBe(67);
    // 2028 row: totalIncome = 0 + 200; netIncome = 200 − 40
    expect(m.rows[1].totalIncome).toBe(200);
    expect(m.rows[1].netIncome).toBe(160);
    // totals = column sums
    expect(m.totals.totalIncome).toBe(300);
    expect(m.totals.totalTax).toBe(73);
    expect(m.totals.netIncome).toBe(227);
  });

  it("reports no activity when no year has an equity tax impact", () => {
    const m = buildEquityTaxImpact([projYear(2026), projYear(2027)]);
    expect(m.hasActivity).toBe(false);
    expect(m.rows).toEqual([]);
  });
});
