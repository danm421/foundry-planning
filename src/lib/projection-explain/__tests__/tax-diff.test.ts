// src/lib/projection-explain/__tests__/tax-diff.test.ts
import { describe, expect, it } from "vitest";
import { diffTaxYears } from "../subjects/tax-diff";
import type { DrillContext } from "../types";
import { DRILL_CTX, makeLedger, makeTaxDetail, makeTaxResult, makeYear } from "./fixtures";

/**
 * Cooper-shaped decumulation boundary: the Client 401k depletes funding 2061,
 * so in 2062 the Spouse 401k carries the load — a $90k RMD (from the ledger,
 * NOT withdrawals.byAccount) plus a $400k supplemental draw. Both are fully
 * pre-tax, so recognized == cashOut and the ratio pins to 1.0.
 *
 * Real engine state: `totalIncome` already folds in the RMD
 * (projection.ts: totalIncome = displayIncome.total + householdRmdIncome + …),
 * so 2062's totalIncome is $190k = $100k non-portfolio income + $90k RMD. Net
 * need = totalExpenses − (totalIncome − RMD) = 590k − 100k = 490k, which equals
 * total funding, so residualNote stays undefined for the RIGHT reason.
 */
function cooperFundingFixture() {
  const prev = makeYear({
    year: 2061,
    withdrawals: { byAccount: { client401k: 300_000 }, total: 300_000 },
    accountLedgers: {
      client401k: makeLedger({ beginningValue: 300_000, endingValue: 0 }),
      spouse401k: makeLedger({ beginningValue: 1_500_000, endingValue: 1_450_000 }),
    },
    taxDetail: makeTaxDetail({ "withdrawal:client401k": { type: "ordinary", amount: 300_000 } }),
    totalIncome: 100_000,
    totalExpenses: 400_000,
  });
  const next = makeYear({
    year: 2062,
    withdrawals: { byAccount: { spouse401k: 400_000 }, total: 400_000 },
    accountLedgers: {
      client401k: makeLedger({ beginningValue: 0, endingValue: 0 }),
      spouse401k: makeLedger({ beginningValue: 1_450_000, rmdAmount: 90_000, endingValue: 960_000 }),
    },
    taxDetail: makeTaxDetail({
      "withdrawal:spouse401k": { type: "ordinary", amount: 400_000 },
      "spouse401k:rmd": { type: "ordinary", amount: 90_000 },
    }),
    totalIncome: 190_000, // $100k non-portfolio income + $90k RMD (engine folds RMD into totalIncome)
    totalExpenses: 590_000,
  });
  const ctx: DrillContext = {
    ...DRILL_CTX,
    accountNames: { client401k: "Client 401k", spouse401k: "Spouse 401k" },
  };
  return { prev, next, ctx };
}

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

  it("funding picture reconciles RMD + supplemental to net need", () => {
    const { prev, next, ctx } = cooperFundingFixture(); // Client 401k depletes 2061; Spouse 401k RMD $90k + supp $400k in 2062
    const diff = diffTaxYears(prev, next, ctx);
    const wp = diff.withdrawalPicture;
    const spouse = wp.byAccount.find((r) => r.account.includes("Spouse 401k"))!;
    expect(spouse.rmd).toBe(90_000);
    expect(spouse.supplemental).toBe(400_000);
    expect(spouse.cashOut).toBe(490_000);
    expect(spouse.recognized).toBe(490_000); // fully pre-tax
    expect(spouse.ratio).toBeCloseTo(1, 2);
    expect(wp.totalFundingNext).toBe(490_000);
    expect(wp.residualNote).toBeUndefined(); // balances within 1%
  });

  it("flags a next-year funding row as depleted when its prior-year balance ended below DEPLETED_EPS", () => {
    // New (funding) shape: a row is depleted when the account ended the prior
    // year near $0 yet still draws in the asked year. A healthy account with a
    // large prior balance is not depleted.
    const prev = makeYear({
      year: 2062,
      accountLedgers: {
        ira: makeLedger({ beginningValue: 200_000, endingValue: 50 }), // all but drained
        brok: makeLedger({ beginningValue: 500_000, endingValue: 460_000 }),
      },
    });
    const next = makeYear({
      year: 2063,
      withdrawals: { byAccount: { ira: 190_000, brok: 40_000 }, total: 230_000 },
      accountLedgers: {
        ira: makeLedger({ beginningValue: 50, endingValue: 0 }),
        brok: makeLedger({ beginningValue: 460_000, endingValue: 420_000 }),
      },
      taxDetail: makeTaxDetail({
        "withdrawal:ira": { type: "ordinary", amount: 190_000 },
        "withdrawal:brok": { type: "capGains", amount: 8_000 },
      }),
    });
    const rows = diffTaxYears(prev, next, DRILL_CTX).withdrawalPicture.byAccount;
    const ira = rows.find((r) => r.account === "Dan IRA");
    const brok = rows.find((r) => r.account === "Joint Brokerage");
    expect(ira).toMatchObject({ depleted: true, cashOut: 190_000, priorYearEndingBalance: 50 });
    expect(brok).toMatchObject({ depleted: false, cashOut: 40_000, priorYearEndingBalance: 460_000 });
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
