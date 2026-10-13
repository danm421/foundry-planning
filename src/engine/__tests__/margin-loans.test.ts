import { describe, it, expect } from "vitest";
import { MARGINED, runMargin } from "./_fixtures/margin";

describe("margin loans — yearly math", () => {
  it("year 1: net seed, growth on gross, interest added to the loan", () => {
    const [y1] = runMargin([MARGINED]);
    const l = y1.accountLedgers["acct-margin"];
    expect(l.beginningValue).toBeCloseTo(8_000_000, 2);
    expect(l.growth).toBeCloseTo(700_000, 2);
    expect(l.marginInterest).toBeCloseTo(40_000, 2);
    expect(l.marginBoY).toBeCloseTo(2_000_000, 2);
    expect(l.marginEoY).toBeCloseTo(2_040_000, 2);
    expect(l.endingValue).toBeCloseTo(8_660_000, 2);
    const entry = l.entries.find((e) => e.category === "margin_interest");
    expect(entry?.amount).toBeCloseTo(-40_000, 2);
    expect(entry?.label).toBe("Margin interest (2.00%)");
    expect(entry?.basis).toBe(0);
    expect(l.entries.find((e) => e.category === "growth")?.label)
      .toBe("Growth (7.00% on securities incl. margin loan)");
  });

  it("year 2 grows on $10.7M and charges interest on $2.04M", () => {
    const [, y2] = runMargin([MARGINED]);
    const l = y2.accountLedgers["acct-margin"];
    expect(l.growth).toBeCloseTo(749_000, 2);
    expect(l.marginInterest).toBeCloseTo(40_800, 2);
    expect(l.endingValue).toBeCloseTo(8_660_000 + 749_000 - 40_800, 2);
  });

  it("0% growth still charges interest (Review Focus 3)", () => {
    const [y1] = runMargin([{ ...MARGINED, growthRate: 0 }], 1);
    expect(y1.accountLedgers["acct-margin"].endingValue).toBeCloseTo(7_960_000, 2);
  });

  it("realization is computed on the gross growth", () => {
    const [y1] = runMargin([{ ...MARGINED, realization: {
      pctOrdinaryIncome: 0.1, pctQualifiedDividends: 0, pctLtCapitalGains: 0.9, pctTaxExempt: 0, turnoverPct: 0,
    } }], 1);
    expect(y1.accountLedgers["acct-margin"].growthDetail!.ordinaryIncome).toBeCloseTo(70_000, 2);
  });

  it("an account with marginBalance 0 is identical to one with no margin fields", () => {
    const { marginBalance: _a, marginInterestRate: _b, marginCallPct: _c, ...plain } = MARGINED;
    expect(runMargin([{ ...MARGINED, marginBalance: 0 }])).toEqual(runMargin([plain]));
  });
});
