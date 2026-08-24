import { describe, it, expect } from "vitest";
import {
  buildEarlyYearsDebtOrInvestData,
  omitEarlyYearsDebtOrInvest,
  EARLY_YEARS_DEBT_OR_INVEST_PAGE_ID,
  LOAN_ARM_KEY,
  INVEST_ARM_KEY,
} from "../view-model";
import { derivedKey } from "@/lib/presentations/derived-refs";
import type { BuildDataContext, DeckOmitContext } from "@/components/presentations/registry";

const OPTS = { monthlyAmount: 500, liabilityId: null, milestoneAge: 65, tidbits: [] };

/** `bal` is the loan's start-of-year balance, `interest` its interest that year. */
const yr = (age: number, bal: number, interest: number, liquid: number) => ({
  year: 2026 + (age - 29),
  ages: { client: age },
  income: { salaries: 120_000, total: 120_000 },
  savings: { byAccount: {}, total: 12_000, employerTotal: 0 },
  expenses: { taxes: 0, total: 0, interestByLiability: { l1: interest } },
  liabilityBalancesBoY: { l1: bal },
  portfolioAssets: { liquidTotal: liquid },
});

const clientData = {
  planSettings: { inflationRate: 0, planStartYear: 2026 },
  client: { retirementAge: 65 },
  liabilities: [
    { id: "l1", name: "Student loan", balance: 30_000, interestRate: 0.055,
      monthlyPayment: 350, startYear: 2024, startMonth: 1, termMonths: 120,
      extraPayments: [], owners: [] },
  ],
  // `owners` is required on an Account, and `controllingFamilyMember` reads it
  // unguarded — a fixture without it throws before any assertion runs.
  accounts: [{ id: "a1", subType: "401k", owners: [] }],
  savingsRules: [
    { id: "r1", accountId: "a1", annualAmount: 0, annualPercent: 0.08,
      isDeductible: true, startYear: 2020, endYear: 2060 },
  ],
  incomes: [
    { id: "i1", type: "salary", name: "S", annualAmount: 120_000, owner: "client",
      growthRate: 0, startYear: 2020, endYear: 2060 },
  ],
};

/** ages 29..65. `owingYears` is how many still carry a balance. */
const arm = (owingYears: number, interestPerYear: number, at65: number) =>
  Array.from({ length: 37 }, (_, i) =>
    yr(29 + i, i < owingYears ? 30_000 : 0, i < owingYears ? interestPerYear : 0,
       29 + i === 65 ? at65 : 100_000),
  );

function ctx(
  base: ReturnType<typeof arm>,
  loan: ReturnType<typeof arm>,
  invest: ReturnType<typeof arm>,
): BuildDataContext {
  const b = (ys: ReturnType<typeof arm>, label: string) => ({
    clientData, projection: { years: ys }, scenarioLabel: label,
  });
  return {
    years: base,
    projection: { years: base },
    clientData,
    scenarioLabel: "Base Case",
    bundlesByRef: {
      base: b(base, "Base Case"),
      [derivedKey(EARLY_YEARS_DEBT_OR_INVEST_PAGE_ID, LOAN_ARM_KEY)]: b(loan, "Onto the loan"),
      [derivedKey(EARLY_YEARS_DEBT_OR_INVEST_PAGE_ID, INVEST_ARM_KEY)]: b(invest, "Into the 401(k)"),
    },
  } as unknown as BuildDataContext;
}

describe("buildEarlyYearsDebtOrInvestData", () => {
  const base = arm(10, 1_400, 900_000);
  const loanArm = arm(6, 1_100, 930_000);
  const investArm = arm(10, 1_400, 985_000);

  it("names the loan and the amount on the sheet", () => {
    const d = buildEarlyYearsDebtOrInvestData(ctx(base, loanArm, investArm), OPTS);
    expect(d.liabilityName).toBe("Student loan");
    expect(d.monthlyAmount).toBe(500);
  });

  it("reports the debt-free year each arm reaches", () => {
    const d = buildEarlyYearsDebtOrInvestData(ctx(base, loanArm, investArm), OPTS);
    expect(d.loan!.debtFreeYear).toBe(2032); // 2026 + 6
    expect(d.invest!.debtFreeYear).toBe(2036); // the scheduled term
  });

  it("reports each arm's interest bill on THIS loan only", () => {
    const d = buildEarlyYearsDebtOrInvestData(ctx(base, loanArm, investArm), OPTS);
    expect(d.loan!.interestPaid.today).toBeCloseTo(6 * 1_100, 6);
    expect(d.loan!.interestPaid.nominal).toBe(6 * 1_100);
    expect(d.invest!.interestPaid.today).toBeCloseTo(10 * 1_400, 6);
  });

  it("reports the portfolio at the milestone age, from each arm's own projection", () => {
    const d = buildEarlyYearsDebtOrInvestData(ctx(base, loanArm, investArm), OPTS);
    expect(d.loan!.portfolioAtMilestone).toEqual({ today: 930_000, nominal: 930_000 });
    expect(d.invest!.portfolioAtMilestone).toEqual({ today: 985_000, nominal: 985_000 });
  });

  it("names the arm that ends with more, and by how much", () => {
    const d = buildEarlyYearsDebtOrInvestData(ctx(base, loanArm, investArm), OPTS);
    expect(d.takeaway).toContain("401(k)");
    expect(d.takeaway).toContain("age 65");
    expect(d.takeaway).toContain("today");
    expect(d.takeaway).toContain("future-year dollars");
  });

  it("says nothing rather than declaring a winner over a rounding difference", () => {
    const d = buildEarlyYearsDebtOrInvestData(ctx(base, loanArm, arm(10, 1_400, 930_000)), OPTS);
    expect(d.takeaway).toBeNull();
  });

  it("renders its empty state when a variant is missing", () => {
    const c = ctx(base, loanArm, investArm);
    delete (c.bundlesByRef as Record<string, unknown>)[
      derivedKey(EARLY_YEARS_DEBT_OR_INVEST_PAGE_ID, INVEST_ARM_KEY)
    ];
    const d = buildEarlyYearsDebtOrInvestData(c, OPTS);
    expect(d.loan).toBeNull();
    expect(d.invest).toBeNull();
    expect(d.emptyMessage).not.toBeNull();
  });

  it("adds five-year and payoff balance checkpoints without rows after both loans clear", () => {
    const d = buildEarlyYearsDebtOrInvestData(ctx(base, loanArm, investArm), OPTS);
    expect(d.detailRows.map((row) => row.year)).toEqual([2026, 2031, 2032]);
    expect(d.detailRows.find((row) => row.year === 2032)?.loanBalance.nominal).toBe(0);
    expect(d.detailRows.find((row) => row.year === 2032)?.investBalance.nominal).toBe(30_000);
    expect(
      d.detailRows.some(
        (row) => row.loanBalance.nominal === 0 && row.investBalance.nominal === 0,
      ),
    ).toBe(false);
  });
});

describe("omitEarlyYearsDebtOrInvest", () => {
  const omitCtx = (over: Record<string, unknown>): DeckOmitContext =>
    ({
      clientData: { ...clientData, ...over },
      projection: { years: [] },
      bundles: {},
    }) as unknown as DeckOmitContext;

  it("keeps the page on a plan with a loan and a deferral", () => {
    expect(omitEarlyYearsDebtOrInvest(omitCtx({}), OPTS)).toBe(false);
  });

  it("drops the page on a debt-free plan", () => {
    expect(omitEarlyYearsDebtOrInvest(omitCtx({ liabilities: [] }), OPTS)).toBe(true);
  });

  it("drops the page when there is no deferral for the other arm to go into", () => {
    expect(omitEarlyYearsDebtOrInvest(omitCtx({ savingsRules: [] }), OPTS)).toBe(true);
  });

  it("prefers the BASE bundle's tree when the deck is built on another scenario", () => {
    const c = {
      clientData: { ...clientData, liabilities: [] },
      projection: { years: [] },
      bundles: { base: { clientData, projection: { years: [] }, scenarioLabel: "Base Case" } },
    } as unknown as DeckOmitContext;
    expect(omitEarlyYearsDebtOrInvest(c, OPTS)).toBe(false);
  });
});
