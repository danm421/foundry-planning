// src/lib/reports/tax-cell-drill/__tests__/income-breakdown.test.ts
import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import type { TaxResult } from "@/lib/tax/types";
import { buildIncomeCellDrill } from "../income-breakdown";
import type { CellDrillContext } from "../types";

const ctx: CellDrillContext = {
  accountNames: { acc_1: "Joint Brokerage", acc_2: "401k", acc_3: "Roth IRA" },
  incomes: [
    { id: "inc_w", name: "Client Salary", type: "salary", owner: "client", annualAmount: 0, startYear: 0, endYear: 0, growthRate: 0 } as never,
    { id: "inc_ss_c", name: "Client SS", type: "social_security", owner: "client", annualAmount: 0, startYear: 0, endYear: 0, growthRate: 0 } as never,
    { id: "inc_ss_s", name: "Spouse SS", type: "social_security", owner: "spouse", annualAmount: 0, startYear: 0, endYear: 0, growthRate: 0 } as never,
  ],
  accounts: [
    { id: "acc_1", subType: "brokerage" } as never,
    { id: "acc_2", subType: "trad_ira" } as never,
    { id: "acc_3", subType: "roth_ira", name: "Roth IRA" } as never,
  ],
};

function makeYear(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  const taxResult = {
    income: {
      earnedIncome: 100_000,
      taxableSocialSecurity: 17_000,
      ordinaryIncome: 8_000,
      dividends: 3_000,
      capitalGains: 4_000,
      shortCapitalGains: 1_000,
      totalIncome: 133_000,
      nonTaxableIncome: 4_500,
      grossTotalIncome: 137_500,
    },
    flow: { incomeTaxBase: 120_000 },
    diag: { marginalFederalRate: 0.22, marginalBracketTier: { from: 94300, to: 201050, rate: 0.22 } },
  } as unknown as TaxResult;
  return {
    year: 2030,
    ages: { client: 67, spouse: 65 },
    income: {
      salaries: 100_000,
      socialSecurity: 20_000,
      business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0,
      total: 120_000,
      bySource: { inc_w: 100_000, inc_ss_c: 12_000, inc_ss_s: 8_000 },
    },
    taxResult,
    taxDetail: {
      earnedIncome: 100_000,
      ordinaryIncome: 8_000,
      dividends: 3_000,
      capitalGains: 4_000,
      stCapitalGains: 1_000,
      qbi: 0,
      taxExempt: 1_500,
      bySource: {
        inc_w: { type: "earned_income", amount: 100_000 },
        "acc_1:oi": { type: "ordinary_income", amount: 8_000 },
        "acc_1:qdiv": { type: "dividends", amount: 3_000 },
        "acc_1:ltcg": { type: "capital_gains", amount: 4_000 },
        "acc_1:stcg": { type: "stcg", amount: 1_000 },
        "acc_3:te": { type: "tax_exempt", amount: 1_500 },
      },
    },
    withdrawals: { byAccount: {}, total: 0 },
    ...overrides,
  } as unknown as ProjectionYear;
}

describe("buildIncomeCellDrill — direct columns", () => {
  it("Earned Income returns sources with type earned_income", () => {
    const props = buildIncomeCellDrill({ year: makeYear(), columnKey: "earnedIncome", ctx });
    expect(props.title).toBe("Earned Income — 2030");
    expect(props.total).toBe(100_000);
    expect(props.groups).toHaveLength(1);
    expect(props.groups[0].rows).toEqual([
      { id: "inc_w", label: "Client Salary", amount: 100_000 },
    ]);
  });

  it("Ordinary Income filters by ordinary_income type", () => {
    const props = buildIncomeCellDrill({ year: makeYear(), columnKey: "ordinaryIncome", ctx });
    expect(props.total).toBe(8_000);
    expect(props.groups[0].rows.map((r) => r.label)).toEqual(["Joint Brokerage — OI"]);
  });

  it("Dividends filters by dividends type", () => {
    const props = buildIncomeCellDrill({ year: makeYear(), columnKey: "dividends", ctx });
    expect(props.total).toBe(3_000);
    expect(props.groups[0].rows[0].label).toBe("Joint Brokerage — Qual Div");
  });

  it("LT Cap Gains filters by capital_gains type", () => {
    const props = buildIncomeCellDrill({ year: makeYear(), columnKey: "capitalGains", ctx });
    expect(props.total).toBe(4_000);
    expect(props.groups[0].rows.map((r) => r.amount)).toEqual([4_000]);
  });

  it("ST Cap Gains filters by stcg type", () => {
    const props = buildIncomeCellDrill({ year: makeYear(), columnKey: "shortCapitalGains", ctx });
    expect(props.total).toBe(1_000);
    expect(props.groups[0].rows.map((r) => r.label)).toEqual(["Joint Brokerage — ST CG"]);
  });

  it("rows are sorted desc by amount", () => {
    const year = makeYear({
      taxDetail: {
        earnedIncome: 100_000, ordinaryIncome: 0, dividends: 0,
        capitalGains: 0, stCapitalGains: 0, qbi: 0, taxExempt: 0,
        bySource: {
          inc_a: { type: "earned_income", amount: 30_000 },
          inc_b: { type: "earned_income", amount: 70_000 },
        },
      } as never,
    });
    const props = buildIncomeCellDrill({ year, columnKey: "earnedIncome", ctx });
    expect(props.groups[0].rows.map((r) => r.amount)).toEqual([70_000, 30_000]);
  });

  it("zero-value cells return an empty group", () => {
    const year = makeYear({
      taxDetail: {
        earnedIncome: 0, ordinaryIncome: 0, dividends: 0,
        capitalGains: 0, stCapitalGains: 0, qbi: 0, taxExempt: 0,
        bySource: {},
      } as never,
    });
    const props = buildIncomeCellDrill({ year, columnKey: "earnedIncome", ctx });
    expect(props.total).toBe(0);
    expect(props.groups[0].rows).toEqual([]);
  });

  it("missing taxDetail (defensive) yields zero total + empty rows, not a throw", () => {
    const year = makeYear({ taxDetail: undefined } as never);
    const props = buildIncomeCellDrill({ year, columnKey: "earnedIncome", ctx });
    expect(props.total).toBe(0);
    expect(props.groups[0].rows).toEqual([]);
  });
});

describe("buildIncomeCellDrill — Taxable Social Security", () => {
  it("splits taxable SS proportionally across SS income sources", () => {
    // Household: SS gross 20,000 (12k client + 8k spouse), taxable 17,000.
    // taxable fraction = 0.85. Per-source: client 10,200 / spouse 6,800.
    const props = buildIncomeCellDrill({ year: makeYear(), columnKey: "taxableSocialSecurity", ctx });
    expect(props.title).toBe("Taxable Social Security — 2030");
    expect(props.total).toBe(17_000);
    const rows = props.groups[0].rows;
    expect(rows).toHaveLength(2);
    // Sorted desc by taxable amount.
    expect(rows[0]).toMatchObject({ id: "inc_ss_c", label: "Client SS", amount: 10_200 });
    expect(rows[1]).toMatchObject({ id: "inc_ss_s", label: "Spouse SS", amount: 6_800 });
    // Sum reconciles exactly with the cell value.
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(17_000);
  });

  it("returns empty rows when SS gross is 0 (avoids divide-by-zero)", () => {
    const year = makeYear({
      income: {
        salaries: 100_000, socialSecurity: 0,
        business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0,
        total: 100_000, bySource: { inc_w: 100_000 },
      } as never,
      taxResult: {
        income: { earnedIncome: 100_000, taxableSocialSecurity: 0, ordinaryIncome: 0,
          dividends: 0, capitalGains: 0, shortCapitalGains: 0,
          totalIncome: 100_000, nonTaxableIncome: 0, grossTotalIncome: 100_000 },
        flow: { incomeTaxBase: 100_000 },
        diag: { marginalFederalRate: 0.22, marginalBracketTier: { from: 94300, to: 201050, rate: 0.22 } },
      } as never,
    });
    const props = buildIncomeCellDrill({ year, columnKey: "taxableSocialSecurity", ctx });
    expect(props.total).toBe(0);
    expect(props.groups[0].rows).toEqual([]);
  });
});

describe("buildIncomeCellDrill — Non-Taxable Income", () => {
  it("renders two groups: tax-exempt + non-taxable SS", () => {
    // Tax-exempt: 1,500 (acc_3:te). Non-taxable SS: 20,000 - 17,000 = 3,000.
    // Per-source split (gross client 12k / spouse 8k, fraction 0.15):
    //   client = 1,800, spouse = 1,200.
    const props = buildIncomeCellDrill({ year: makeYear(), columnKey: "nonTaxableIncome", ctx });
    expect(props.total).toBe(4_500);
    expect(props.groups).toHaveLength(2);

    const exempt = props.groups[0];
    expect(exempt.label).toBe("Tax-Exempt Income");
    expect(exempt.rows).toEqual([
      { id: "acc_3:te", label: "Roth IRA — TE", amount: 1_500 },
    ]);

    const ss = props.groups[1];
    expect(ss.label).toBe("Non-Taxable Social Security");
    expect(ss.rows).toHaveLength(2);
    expect(ss.rows[0]).toMatchObject({ id: "inc_ss_c", amount: 1_800 });
    expect(ss.rows[1]).toMatchObject({ id: "inc_ss_s", amount: 1_200 });

    // Reconciliation: sum across both groups equals the cell.
    const sum = props.groups.flatMap((g) => g.rows).reduce((s, r) => s + r.amount, 0);
    expect(Math.abs(sum - 4_500)).toBeLessThanOrEqual(1);
  });

  it("omits a group when it has no rows", () => {
    // No tax-exempt items, no SS.
    const year = makeYear({
      income: {
        salaries: 100_000, socialSecurity: 0,
        business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0,
        total: 100_000, bySource: { inc_w: 100_000 },
      } as never,
      taxResult: {
        income: { earnedIncome: 100_000, taxableSocialSecurity: 0, ordinaryIncome: 0,
          dividends: 0, capitalGains: 0, shortCapitalGains: 0,
          totalIncome: 100_000, nonTaxableIncome: 0, grossTotalIncome: 100_000 },
        flow: { incomeTaxBase: 100_000 },
        diag: { marginalFederalRate: 0.22, marginalBracketTier: { from: 94300, to: 201050, rate: 0.22 } },
      } as never,
      taxDetail: {
        earnedIncome: 100_000, ordinaryIncome: 0, dividends: 0,
        capitalGains: 0, stCapitalGains: 0, qbi: 0, taxExempt: 0,
        bySource: { inc_w: { type: "earned_income", amount: 100_000 } },
      } as never,
    });
    const props = buildIncomeCellDrill({ year, columnKey: "nonTaxableIncome", ctx });
    expect(props.total).toBe(0);
    expect(props.groups).toHaveLength(0);
  });
});
