import type { ClientData, ProjectionYear } from "@/engine/types";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";
import { buildSolverCashFlowData } from "../view-model";

interface YearSpec {
  year: number;
  socialSecurity?: number;
  rentals?: number;
  withdrawals?: Record<string, number>;
  living?: number;
  mortgages?: Record<string, number>;
  taxes?: number;
  liquid?: number;
}

/** Only what the year breakdown, the chart and Withdrawal % read. */
export function makeYear(spec: YearSpec): ProjectionYear {
  const socialSecurity = spec.socialSecurity ?? 0;
  const rentals = spec.rentals ?? 0;
  const withdrawals = spec.withdrawals ?? {};
  const mortgages = spec.mortgages ?? {};
  const living = spec.living ?? 0;
  const taxes = spec.taxes ?? 0;
  const liabilities = Object.values(mortgages).reduce((s, v) => s + v, 0);
  const totalIncome = socialSecurity + rentals;
  const totalExpenses = living + liabilities + taxes;
  const bySource: Record<string, number> = {};
  if (socialSecurity) bySource["inc-ss"] = socialSecurity;
  if (rentals) bySource["inc-rent"] = rentals;
  return {
    year: spec.year,
    ages: { client: spec.year - 1967, spouse: spec.year - 1964 },
    income: {
      salaries: 0, socialSecurity, business: 0, trust: 0, deferred: 0,
      capitalGains: 0, other: rentals, total: totalIncome, bySource,
    },
    withdrawals: {
      byAccount: withdrawals,
      total: Object.values(withdrawals).reduce((s, v) => s + v, 0),
    },
    expenses: {
      living, taxes, liabilities, other: 0, insurance: 0, realEstate: 0,
      cashGifts: 0, discretionary: 0, total: totalExpenses,
      bySource: living ? { "exp-living": living } : {},
      byLiability: mortgages, interestByLiability: {},
    },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    totalIncome,
    totalExpenses,
    netCashFlow: totalIncome - totalExpenses,
    accountLedgers: {},
    portfolioAssets: { taxableTotal: spec.liquid ?? 0, cashTotal: 0, retirementTotal: 0, liquidTotal: spec.liquid ?? 0 },
  } as unknown as ProjectionYear;
}

export function clientData(liabilityCount = 1): ClientData {
  const base = makeClientData();
  const owners = [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }];
  return {
    ...base,
    accounts: [
      { id: "acc-schwab", name: "Schwab HY", category: "taxable", owners },
      { id: "acc-cash", name: "Cash", category: "cash", owners },
    ],
    incomes: [
      { id: "inc-ss", name: "Social Security — David", type: "social_security" },
      { id: "inc-rent", name: "Rentals", type: "other" },
    ],
    expenses: [{ id: "exp-living", name: "Living Expenses", type: "living" }],
    liabilities: Array.from({ length: liabilityCount }, (_, i) => ({
      id: `liab-${i}`,
      name: `Mortgage ${i}`,
    })),
  } as unknown as ClientData;
}

/** 2026 draws on the portfolio; 2027 doesn't. */
export const YEARS = [
  makeYear({
    year: 2026,
    socialSecurity: 22_742,
    rentals: 66_300,
    withdrawals: { "acc-schwab": 9_952, "acc-cash": 17_306 },
    living: 64_000,
    mortgages: { "liab-0": 10_466 },
    taxes: 34_800,
    liquid: 1_627_541,
  }),
  makeYear({ year: 2027, socialSecurity: 50_000, rentals: 66_300, living: 64_000, taxes: 30_000, liquid: 1_650_000 }),
];

export function build(year: number | null = null, data = clientData(), years = YEARS) {
  return buildSolverCashFlowData({
    years,
    clientData: data,
    options: { year },
    scenarioLabel: "Base Case",
    clientName: "Jennifer",
    spouseName: "David",
  });
}

/** 2026 with living expenses and `count` $1,000 mortgages, each its own line
 *  item under Liabilities — the way to grow the Outflows column. */
export function withLiabilities(count: number) {
  const mortgages = Object.fromEntries(Array.from({ length: count }, (_, i) => [`liab-${i}`, 1_000]));
  return build(2026, clientData(count), [makeYear({ year: 2026, living: 64_000, mortgages })]);
}
