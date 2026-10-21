import { describe, it, expect } from "vitest";
import { runMargin, runBorrow, BORROWER, CHECKING } from "./_fixtures/margin";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, FIXTURE_TAX_PARAMS } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account } from "../types";

const ZERO_TAX = { flatFederalRate: 0, flatStateRate: 0 };
const acct = (over: Partial<Account>): Account => ({
  id: "m", name: "Schwab Brokerage", category: "taxable", subType: "brokerage", titlingType: "jtwros",
  value: 1_000_000, basis: 400_000, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  marginBalance: 500_000, marginInterestRate: 0, marginCallPct: 0.3, ...over,
});

describe("forced sale on a margin call (spec 2026-10-14)", () => {
  const [y1, y2] = runMargin([acct({})], 2, { ...ZERO_TAX, marketShock: { year: 2026, drawdownPct: 0.4 } });
  const l = y1.accountLedgers.m;

  it("example D: sells just enough to restore the 30% call level", () => {
    expect(y1.marginSales).toEqual([{ accountId: "m", reason: "call", sold: expect.closeTo(266_666.67, 2), gain: expect.closeTo(88_888.89, 2) }]);
    expect(l.marginEoY).toBeCloseTo(233_333.33, 2);
    expect(l.endingValue).toBeCloseTo(100_000, 2);
    expect(l.basisEoY).toBeCloseTo(222_222.22, 2);
    expect(l.withdrawalDetail?.realizedLtcg).toBeCloseTo(88_888.89, 2);
  });
  it("the gain is taxed this year, itemized under the account", () => {
    expect(y1.taxDetail!.capitalGains).toBeCloseTo(88_888.89, 2);
    expect(y1.taxDetail!.bySource["margin_sale:call:m"]).toEqual({ type: "capital_gains", amount: expect.closeTo(88_888.89, 2) });
  });
  it("a restored account doesn't warn or sell again (Review Focus 4)", () => {
    expect(y1.marginCallWarnings).toBeUndefined();
    expect(y2.marginSales).toBeUndefined();
  });
  it("underwater: sells every security, the rest of the loan stays, the warning fires", () => {
    const [u] = runMargin([acct({ marginBalance: 900_000 })], 1, { ...ZERO_TAX, marketShock: { year: 2026, drawdownPct: 0.5 } });
    expect(u.marginSales?.[0].sold).toBeCloseTo(500_000, 2);
    expect(u.marginSales?.[0].gain).toBeCloseTo(100_000, 2);
    expect(u.accountLedgers.m.marginEoY).toBeCloseTo(400_000, 2);
    expect(u.accountLedgers.m.endingValue).toBeCloseTo(-400_000, 2);
    expect(u.marginCallWarnings?.[0].accountId).toBe("m");
  });
  it("an exhausted account books no phantom sale: a sell-everything call, then an interest year (I2/W1)", () => {
    // $110K/yr spending borrows to the cap, then calls sell it down: 2034's
    // call sells every security and leaves +9.1e-13 of float "securities".
    const years = runBorrow([BORROWER], { years: 10, spend: 110_000 });
    const y2034 = years.find((y) => y.year === 2034)!;
    const y2035 = years.find((y) => y.year === 2035)!;
    expect(y2034.marginSales).toEqual([expect.objectContaining({ reason: "call", sold: expect.closeTo(38_619.26, 2) })]);
    expect(y2035.accountLedgers["acct-borrow"].marginInterest).toBeGreaterThan(0);
    expect(y2035.marginSales).toBeUndefined();
    expect(y2035.marginCallWarnings?.[0].accountId).toBe("acct-borrow");
  });
  it("a breach caused by the year's own draws warns at year end and sells at next year's check", () => {
    const big = acct({ value: 10_000_000, basis: 10_000_000, marginBalance: 2_000_000 });
    const years = runBorrow([big], { spend: 7_500_000 });
    expect(years[0].marginSales).toBeUndefined();
    expect(years[0].marginCallWarnings?.[0].accountId).toBe("m");
    expect(years[1].marginSales?.[0].reason).toBe("call");
  });
});

describe("spending sells a margined account only down to its call level (2026-10-21)", () => {
  // The bigger account comes first in the default order. Before this rule the
  // plan spent its equity to $0 and the next year's call sold every security
  // to clear the loan — a one-year tax spike (McCormick, prod 2040).
  const margined = acct({ value: 10_000_000, basis: 10_000_000, marginBalance: 2_000_000 });
  const other = acct({ id: "t", name: "Other Brokerage", value: 5_000_000, basis: 5_000_000, marginBalance: 0 });
  const [y1, y2, y3] = runBorrow([margined, other], { years: 3, spend: 4_000_000 });

  it("stops at the call level, moves on, and never trips a margin call", () => {
    // Year 2 sells $4M down to net = 30% of the securities; the other account covers the rest.
    expect(y2.accountLedgers.m.endingValue).toBeCloseTo(0.3 * 2_000_000 / 0.7, 2);
    for (const y of [y1, y2, y3]) {
      expect(y.marginCallWarnings).toBeUndefined();
      expect(y.marginSales).toBeUndefined();
      expect(y.accountLedgers.m.marginEoY).toBeCloseTo(2_000_000, 2);
    }
    expect(y3.accountLedgers.t.endingValue).toBeCloseTo(13_000_000 - 12_000_000 - 0.3 * 2_000_000 / 0.7, 2);
  });
});

describe("the repay year (spec 2026-10-14)", () => {
  it("example E: sells the loan's worth of securities and clears the loan", () => {
    const [y1, y2] = runMargin([acct({ value: 1_200_000, basis: 500_000, marginBalance: 300_000, marginRepayYear: 2026 })], 2, ZERO_TAX);
    expect(y1.marginSales).toEqual([{ accountId: "m", reason: "repay", sold: expect.closeTo(300_000, 2), gain: expect.closeTo(175_000, 2) }]);
    expect(y1.accountLedgers.m.marginEoY).toBe(0);
    expect(y1.accountLedgers.m.endingValue).toBeCloseTo(900_000, 2);
    expect(y1.taxDetail!.bySource["margin_sale:repay:m"].amount).toBeCloseTo(175_000, 2);
    expect(y2.accountLedgers.m.marginBoY).toBeUndefined();
  });
  it("in the repay year the margin-call check is skipped — the repay clears more", () => {
    const [y1] = runMargin([acct({ marginRepayYear: 2026 })], 1, { ...ZERO_TAX, marketShock: { year: 2026, drawdownPct: 0.4 } });
    expect(y1.marginSales).toEqual([expect.objectContaining({ reason: "repay", sold: expect.closeTo(500_000, 2) })]);
  });
});

// Final review C1: the gain must reach the `taxableIncome` scalar and
// `capitalGainsInTaxableIncome`, which flat mode taxes — not only taxDetail.
describe("forced and repay sale gains are taxed in every tax mode (final review C1)", () => {
  const FUNDED = { ...CHECKING, value: 500_000, basis: 500_000 };
  const SHOCK = { marketShock: { year: 2026, drawdownPct: 0.4 } };
  const REPAY = { value: 1_200_000, basis: 500_000, marginBalance: 300_000 };
  const cases = [
    { name: "a forced sale (example D)", withSale: acct({}), noSale: acct({}), settings: SHOCK, noSaleSettings: {}, gain: 88_888.89 },
    { name: "a repay-year sale (example E)", withSale: acct({ ...REPAY, marginRepayYear: 2026 }), noSale: acct(REPAY),
      settings: {}, noSaleSettings: {}, gain: 175_000 },
  ];
  const run = (a: Account, settings: object, mode: "flat" | "bracket") =>
    runMargin([FUNDED, a], 1, { flatFederalRate: 0.2, flatStateRate: 0.05, taxEngineMode: mode, ...settings },
      { taxYearRows: FIXTURE_TAX_PARAMS })[0];

  for (const c of cases) {
    it(`flat mode: ${c.name} adds 25% of its gain to the year's tax`, () => {
      const y = run(c.withSale, c.settings, "flat");
      const base = run(c.noSale, c.noSaleSettings, "flat");
      expect(y.marginSales?.[0].gain).toBeCloseTo(c.gain, 2);
      expect(base.marginSales).toBeUndefined();
      expect(y.taxResult!.income.capitalGains).toBeCloseTo(c.gain, 2);
      expect(y.taxResult!.flow.totalTax - base.taxResult!.flow.totalTax).toBeCloseTo(0.25 * c.gain, 2);
    });
    it(`bracket mode: ${c.name} raises the year's tax`, () => {
      const y = run(c.withSale, c.settings, "bracket");
      const base = run(c.noSale, c.noSaleSettings, "bracket");
      expect(y.taxResult!.income.capitalGains).toBeCloseTo(c.gain, 2);
      expect(y.taxResult!.flow.totalTax).toBeGreaterThan(base.taxResult!.flow.totalTax + 1);
    });
  }
});

describe("owners: a margin-call gain is taxed to the account's owners", () => {
  const TRUST_ID = "00000000-0000-0000-0000-0000000000f1";
  // Scaffold copied from capital-loss-realization.test.ts `runTrustResidenceSale`.
  function runTrustOwned(isGrantor: boolean, settings: object = {}) {
    const base = buildClientData({ planSettings: { ...basePlanSettings, ...ZERO_TAX, planStartYear: 2026, planEndYear: 2026,
      marketShock: { year: 2026, drawdownPct: 0.4 }, ...settings }, taxYearRows: FIXTURE_TAX_PARAMS });
    return runProjection({
      ...base,
      accounts: [
        CHECKING,
        { ...CHECKING, id: "trust-chk", name: "Trust Checking", owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }] },
        acct({ owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }] }),
      ],
      incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
      entities: [{ id: TRUST_ID, name: "Test Trust", entityType: "trust", isIrrevocable: true, isGrantor,
        includeInPortfolio: false, grantor: "client" }] as NonNullable<Parameters<typeof runProjection>[0]["entities"]>,
    })[0];
  }
  it("a non-grantor trust's gain stays off the household return", () => {
    const y = runTrustOwned(false);
    expect(y.marginSales?.[0].gain).toBeCloseTo(88_888.89, 2);
    expect(y.taxDetail!.capitalGains).toBeCloseTo(0, 2);
  });
  it("a grantor trust's gain lands on the household return", () => {
    expect(runTrustOwned(true).taxDetail!.capitalGains).toBeCloseTo(88_888.89, 2);
  });
  it("bracket mode: a non-grantor trust's gain stays off the household's tax (C1)", () => {
    const y = runTrustOwned(false, { taxEngineMode: "bracket", flatStateRate: 0.05 });
    expect(y.marginSales?.[0].gain).toBeCloseTo(88_888.89, 2);
    expect(y.taxResult!.income.capitalGains).toBeCloseTo(0, 2);
  });
});
