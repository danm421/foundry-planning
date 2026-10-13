import { describe, it, expect } from "vitest";
import { MARGINED, runMargin } from "./_fixtures/margin";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account } from "../types";

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

describe("margin loans — sale gains use the securities value", () => {
  // Flat year: net $8M + $2M loan = $10M securities against $9M basis, so
  // every dollar drawn realizes a 10% gain. Net-based math would book a loss.
  const SPENDER: Account = { ...MARGINED, basis: 9_000_000, growthRate: 0, marginInterestRate: 0 };
  const CHECKING: Account = {
    id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
    titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  it.each([
    ["the checking-account refill", [CHECKING, SPENDER]],
    ["the no-checking (legacy) path", [SPENDER]],
  ])("a supplemental draw realizes gain on the securities ratio via %s", (_path, accounts) => {
    const [y1] = runMargin(accounts, 1, {}, {
      expenses: [{
        id: "exp-living", type: "living", name: "Living", annualAmount: 1_000_000,
        startYear: 2026, endYear: 2026, growthRate: 0,
      }],
      withdrawalStrategy: [{ accountId: "acct-margin", priorityOrder: 1, startYear: 2026, endYear: 2026 }],
    });
    const drawn = y1.withdrawals.byAccount["acct-margin"];
    expect(y1.taxDetail!.bySource["withdrawal:acct-margin"].amount).toBeCloseTo(drawn * 0.1, 2);
    expect(drawn).toBeGreaterThan(1_000_000); // the expense plus the tax on that gain
  });
});

describe("margin loans — a sale repays the loan", () => {
  it("the year's technique breakdown carries the repaid loan", () => {
    const CHECKING: Account = {
      id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
      titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const [y1] = runMargin([CHECKING, MARGINED], 1, {}, {
      assetTransactions: [{ id: "sale-m", name: "Sell brokerage", type: "sell", year: 2026, accountId: "acct-margin" }],
    });
    const sale = y1.techniqueBreakdown!.sales[0];
    expect(sale.saleValue).toBeCloseTo(10_000_000, 2);
    expect(sale.marginRepaid).toBeCloseTo(2_000_000, 2);
    expect(sale.netProceeds).toBeCloseTo(8_000_000, 2);
  });
});

describe("margin-call warnings", () => {
  it("no warning in a normal year", () => {
    const [y1] = runMargin([MARGINED], 1);
    expect(y1.marginCallWarnings).toBeUndefined();
  });
  it("a 75% crash breaches a 30% margin call level", () => {
    const [y1] = runMargin([{ ...MARGINED, growthRate: 0, marginInterestRate: 0 }], 1,
      { marketShock: { year: 2026, drawdownPct: 0.75 } });
    // gross 2.5M, net 0.5M → ratio 0.2
    expect(y1.marginCallWarnings).toEqual([{ accountId: "acct-margin", ratio: expect.closeTo(0.2, 6), threshold: 0.3 }]);
  });
  it("seeded underwater (value below loan) warns and does not throw (Review Focus 1)", () => {
    const [y1] = runMargin([{ ...MARGINED, value: 1_500_000, growthRate: 0, marginInterestRate: 0 }], 1);
    expect(y1.accountLedgers["acct-margin"].endingValue).toBeCloseTo(-500_000, 2);
    expect(y1.marginCallWarnings?.[0].accountId).toBe("acct-margin");
  });
});
