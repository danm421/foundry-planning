// src/lib/projection-explain/__tests__/tax-diff.test.ts
import { describe, expect, it } from "vitest";
import { diffTaxYears } from "../subjects/tax-diff";
import { DRILL_CTX, makeLedger, makeTaxDetail, makeTaxResult, makeYear } from "./fixtures";

describe("diffTaxYears", () => {
  it("builds the headline and drops sub-$100 tax-line noise", () => {
    const prev = makeYear({
      year: 2062,
      taxResult: makeTaxResult({
        flow: { totalTax: 55_800, totalFederalTax: 50_000, stateTax: 5_800, regularFederalIncomeTax: 48_000, taxableIncome: 150_000, adjustedGrossIncome: 180_000 },
      }),
    });
    const next = makeYear({
      year: 2063,
      taxResult: makeTaxResult({
        flow: { totalTax: 142_000, totalFederalTax: 130_000, stateTax: 12_000, regularFederalIncomeTax: 118_000, capitalGainsTax: 11_970, niit: 30, taxableIncome: 400_000, adjustedGrossIncome: 430_000 },
      }),
    });
    const d = diffTaxYears(prev, next, DRILL_CTX);
    expect(d.headline.totalTax).toEqual({ label: "Total tax", from: 55_800, to: 142_000, delta: 86_200 });
    expect(d.headline.stateTax.delta).toBe(6_200);
    const labels = d.taxLineDeltas.map((l) => l.label);
    expect(labels).toContain("Regular federal income tax");
    expect(labels).toContain("Capital gains tax");
    expect(labels).not.toContain("NIIT"); // $30 delta < LINE_FLOOR
  });

  it("always includes AGI and Taxable income lines even when unchanged", () => {
    const prev = makeYear({ year: 2062 });
    const next = makeYear({ year: 2063 });
    const labels = diffTaxYears(prev, next, DRILL_CTX).incomeDeltas.map((l) => l.label);
    expect(labels).toContain("AGI");
    expect(labels).toContain("Taxable income");
  });

  it("diffs bySource with resolved labels, sorted by |delta| desc", () => {
    const prev = makeYear({
      year: 2062,
      taxDetail: makeTaxDetail({ "withdrawal:brok": { type: "capGains", amount: 20_000 } }),
    });
    const next = makeYear({
      year: 2063,
      taxDetail: makeTaxDetail({
        "withdrawal:ira": { type: "ordinary", amount: 190_000 },
        "ira:rmd": { type: "ordinary", amount: 5_000 },
      }),
    });
    const d = diffTaxYears(prev, next, DRILL_CTX);
    expect(d.sourceDeltas[0]).toEqual({ label: "Dan IRA — Withdrawal", from: 0, to: 190_000, delta: 190_000 });
    expect(d.sourceDeltas.map((s) => s.label)).toContain("Joint Brokerage — Withdrawal");
    expect(d.sourceDeltas.map((s) => s.label)).toContain("Dan IRA — RMD");
  });

  it("marks an account depleted when it drew in prev year and ended below DEPLETED_EPS", () => {
    const prev = makeYear({
      year: 2062,
      withdrawals: { byAccount: { brok: 120_000 }, total: 120_000 },
      accountLedgers: { brok: makeLedger({ beginningValue: 118_000, endingValue: 0 }) },
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { ira: 190_000 }, total: 190_000 },
      accountLedgers: { ira: makeLedger({ beginningValue: 900_000, endingValue: 750_000 }) },
    });
    const rows = diffTaxYears(prev, next, DRILL_CTX).withdrawalPicture.byAccount;
    const brok = rows.find((r) => r.account === "Joint Brokerage");
    const ira = rows.find((r) => r.account === "Dan IRA");
    expect(brok).toMatchObject({ depleted: true, from: 120_000, to: 0, delta: -120_000 });
    expect(ira).toMatchObject({ depleted: false, delta: 190_000 });
  });

  it("blendedRate is Δtax/ΔtaxableIncome clamped, falling back to marginal rate", () => {
    const prev = makeYear({ year: 2062, taxResult: makeTaxResult({ flow: { totalTax: 50_000, taxableIncome: 200_000 } }) });
    const next = makeYear({ year: 2063, taxResult: makeTaxResult({ flow: { totalTax: 80_000, taxableIncome: 300_000 } }) });
    expect(diffTaxYears(prev, next, DRILL_CTX).blendedRate).toBeCloseTo(0.3);
    // taxable income flat → fall back to next year's marginal federal rate
    const flat = makeYear({ year: 2063, taxResult: makeTaxResult({ flow: { totalTax: 80_000, taxableIncome: 200_000 }, marginalFederalRate: 0.24 }) });
    expect(diffTaxYears(prev, flat, DRILL_CTX).blendedRate).toBe(0.24);
  });
});
