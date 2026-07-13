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
    expect(a.observations.length).toBeGreaterThan(3);
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
