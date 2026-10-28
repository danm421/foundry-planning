import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, EntitySummary } from "../types";

// Turnover's sale realizes this year's growth on the sold share as short-term
// and the account's existing gain on it as long-term (basis up, value same).

const realization = {
  pctOrdinaryIncome: 0.15,
  pctQualifiedDividends: 0.15,
  pctLtCapitalGains: 0.7,
  pctTaxExempt: 0,
  turnoverPct: 0.05,
};

// Shaped like a real household's joint Schwab brokerage.
const brokerage: Account = {
  id: "brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
  titlingType: "jtwros",
  value: 4_100_000, basis: 2_980_000, growthRate: 0.065, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  realization,
};

function project(accounts: Account[], entities: EntitySummary[] = []) {
  return runProjection(buildClientData({
    accounts, incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
    entities,
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2028 },
  }));
}

describe("turnover realizes the account's existing gain as long-term", () => {
  const years = project([brokerage]);
  const [y1, y2] = years;
  const l1 = y1.accountLedgers.brokerage;
  const g1 = l1.growthDetail!;

  it("keeps this year's growth slice short-term, as before", () => {
    expect(g1.stCapitalGains).toBeCloseTo(266_500 * 0.7 * 0.05, 2);
    expect(g1.ltCapitalGains).toBeCloseTo(266_500 * 0.7 * 0.95, 2);
  });

  it("realizes turnover × (value − basis) as long-term gain", () => {
    expect(g1.realizedLtCapitalGains).toBeCloseTo((4_100_000 - 2_980_000) * 0.05, 2);
    expect(y1.taxDetail!.bySource["brokerage:ltcg"]).toEqual({ type: "capital_gains", amount: expect.closeTo(56_000, 2) });
    expect(y1.taxDetail!.capitalGains).toBeCloseTo(56_000 + (l1.withdrawalDetail?.realizedLtcg ?? 0), 2);
  });

  it("steps basis up by the realized gain and leaves value alone", () => {
    expect(g1.basisIncrease).toBeCloseTo(g1.ordinaryIncome + g1.qualifiedDividends + g1.stCapitalGains + 56_000, 2);
    const basisReturn = l1.withdrawalDetail?.basisReturn ?? 0;
    expect(y2.accountBasisBoY.brokerage).toBeCloseTo(2_980_000 + g1.basisIncrease - basisReturn, 2);
    expect(l1.growth).toBeCloseTo(266_500, 2);
    expect(l1.entries.filter((e) => e.category === "growth")).toHaveLength(1);
  });

  it("year 2 sells into the gain left after year 1's step-up", () => {
    const l2 = y2.accountLedgers.brokerage;
    const gainBoY2 = l2.beginningValue - y2.accountBasisBoY.brokerage;
    expect(l2.growthDetail!.realizedLtCapitalGains).toBeCloseTo(gainBoY2 * 0.05, 2);
  });
});

describe("turnover edge cases", () => {
  it("an underwater account realizes a long-term loss and steps basis down", () => {
    const underwater: Account = { ...brokerage, id: "under", value: 100_000, basis: 150_000 };
    const [y1, y2] = project([underwater]);
    const g = y1.accountLedgers.under.growthDetail!;
    expect(g.realizedLtCapitalGains).toBeCloseTo(-2_500, 2);
    expect(y1.taxDetail!.bySource["under:ltcg"]?.amount).toBeCloseTo(-2_500, 2);
    const basisReturn = y1.accountLedgers.under.withdrawalDetail?.basisReturn ?? 0;
    expect(y2.accountBasisBoY.under).toBeCloseTo(150_000 + g.basisIncrease - basisReturn, 2);
  });

  it("zero turnover realizes nothing", () => {
    const [y1] = project([{ ...brokerage, realization: { ...realization, turnoverPct: 0 } }]);
    expect(y1.accountLedgers.brokerage.growthDetail!.realizedLtCapitalGains).toBe(0);
    expect(y1.taxDetail!.bySource["brokerage:ltcg"]).toBeUndefined();
  });

  it("a retirement account's turnover realizes nothing (tax-deferred)", () => {
    const ira: Account = { ...brokerage, id: "ira", category: "retirement", subType: "traditional_ira", basis: 0 };
    const [y1] = project([ira]);
    expect(y1.accountLedgers.ira.growthDetail!.realizedLtCapitalGains).toBe(0);
    expect(y1.taxDetail!.bySource["ira:ltcg"]).toBeUndefined();
  });

  it("only the household's share lands on the 1040 when a non-grantor trust co-owns", () => {
    const trust: EntitySummary = {
      id: "t1", includeInPortfolio: true, isGrantor: false, entityType: "trust", isIrrevocable: true,
      grantor: "client", distributionMode: "fixed", distributionAmount: 0, distributionPercent: null,
    };
    const shared: Account = {
      ...brokerage,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
        { kind: "entity", entityId: "t1", percent: 0.4 },
      ],
    };
    const [y1] = project([shared], [trust]);
    expect(y1.taxDetail!.bySource["brokerage:ltcg"]?.amount).toBeCloseTo(56_000 * 0.6, 2);
  });
});
