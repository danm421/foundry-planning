import { describe, it, expect } from "vitest";
import { buildTaxAnalysis } from "../analysis";
import { buildYoY } from "../yoy";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj } from "./fixtures";

const resolver = createTaxResolver([params2025], {
  taxInflationRate: 0.025,
  ssWageGrowthRate: 0.03,
});

describe("buildYoY", () => {
  it("computes deltas across years", () => {
    const prior = retireeMfj();
    prior.taxYear = 2024;
    prior.income.agi = 175000;
    prior.tax.totalTax = 19000;
    const rows = buildYoY(retireeMfj(), prior);
    const agi = rows.find((r) => r.label === "Adjusted gross income")!;
    expect(agi.delta).toBe(188700 - 175000);
    const eff = rows.find((r) => r.label === "Effective federal rate")!;
    expect(eff.kind).toBe("rate");
  });
});

describe("buildTaxAnalysis", () => {
  it("assembles the full bundle for the retiree persona", () => {
    const a = buildTaxAnalysis({
      facts: retireeMfj(), prior: null, resolver, primaryAge: 72, spouseAge: 72,
    });
    expect(a.taxYear).toBe(2025);
    expect(a.keyFigures.agi).toBe(188700);
    expect(a.keyFigures.totalTax).toBe(21588);
    expect(a.keyFigures.effectiveRate).toBeCloseTo(21588 / 188700, 5);
    expect(a.keyFigures.marginalRate).toBeGreaterThan(0);
    expect(a.bracketMap).not.toBeNull();
    expect(a.findings.length).toBeGreaterThan(3);
    expect(a.yoy).toBeNull(); // no prior year
    expect(a.reconstruction.filedPreCreditTax).toBe(21588);
  });

  it("reads totalIncome as null when the return has no line-9 total (retiree fixture)", () => {
    const a = buildTaxAnalysis({
      facts: retireeMfj(), prior: null, resolver, primaryAge: 72, spouseAge: 72,
    });
    expect(a.keyFigures.totalIncome).toBeNull();
  });

  it("surfaces facts.income.totalIncome (1040 line 9) on keyFigures", () => {
    const f = retireeMfj();
    f.income.totalIncome = 195700; // distinct from AGI 188700 (adjustments in between)
    f.income.adjustmentsToIncome = 7000;
    const a = buildTaxAnalysis({ facts: f, prior: null, resolver, primaryAge: 72, spouseAge: 72 });
    expect(a.keyFigures.totalIncome).toBe(195700);
    expect(a.keyFigures.agi).toBe(188700); // unchanged — proves totalIncome ≠ AGI
  });
});

/** A return six years back is not "last year". Comparing against one produced
 *  a Year-over-year table labelled as a year-on-year change that was really a
 *  six-year drift, and — worse — fed §6654's prior-year safe-harbor test a
 *  prior-year tax that was never the prior year's. Both consumers of `prior`
 *  are gated on adjacency in ONE place (buildTaxAnalysis), so the web report
 *  and the PDF cannot disagree about it. */
describe("buildTaxAnalysis prior-year adjacency", () => {
  /** 2019 facts: small enough that using them as "last year's tax" would
   *  wrongly clear the harbor that the current year alone misses. */
  function gapYearPrior() {
    const prior = retireeMfj();
    prior.taxYear = 2019;
    prior.income.agi = 60000;
    prior.tax.totalTax = 5000;
    return prior;
  }

  const build = (prior: ReturnType<typeof retireeMfj> | null) =>
    buildTaxAnalysis({ facts: retireeMfj(), prior, resolver, primaryAge: 72, spouseAge: 72 });

  it("drops the year-over-year table when the prior return is not taxYear - 1", () => {
    expect(build(gapYearPrior()).yoy).toBeNull();
  });

  it("still builds the table when the prior return IS taxYear - 1", () => {
    const prior = gapYearPrior();
    prior.taxYear = 2024; // the only difference from the case above
    const rows = build(prior).yoy;
    expect(rows).not.toBeNull();
    const agi = rows!.find((r) => r.label === "Adjusted gross income")!;
    expect(agi.prior).toBe(60000);
  });

  it("does not let a non-adjacent year satisfy the safe-harbor prior-year test", () => {
    // retiree: totalTax 21588, payments 19000 → 90% harbor of 19429.20 is missed.
    // A 2019 tax of 5000 would make `required` 5000 and silence the finding.
    const finding = build(gapYearPrior()).findings.find((f) => f.id === "safe-harbor");
    expect(finding).toBeDefined();
    expect(finding!.numbers.required).toBeCloseTo(0.9 * 21588, 5);
    expect(finding!.whatTheReturnShows).not.toContain("prior-year test");
  });

  it("uses the prior-year test when the prior year is genuinely adjacent", () => {
    const prior = gapYearPrior();
    prior.taxYear = 2024;
    // AGI 60000 ≤ 150000 → 100% harbor of 5000, met by 19000 of payments.
    expect(build(prior).findings.find((f) => f.id === "safe-harbor")).toBeUndefined();
  });
});
