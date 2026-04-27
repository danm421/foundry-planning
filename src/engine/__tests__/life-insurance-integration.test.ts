/**
 * Projection-level integration tests for life-insurance behaviors.
 *
 * These exercise runProjection directly (not applyFirstDeath / applyFinalDeath),
 * covering scenarios that the death-event-focused integration file at
 * src/engine/death-event/__tests__/life-insurance-integration.test.ts does not:
 *
 *   - Term expiry during a multi-year projection (fixed term + ends-at-retirement)
 *   - Free-form cash-value schedule overrides for in-force years
 *   - Premium-expense synthesis + premiumYears cap wiring into the projection
 *
 * The cross-owned / ILIT / joint-insured / merge-target / beneficiary-routing
 * §2042 scenarios live in the death-event file and are not re-tested here.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { computeTermEndYear } from "../life-insurance-expiry";
import { synthesizePremiumExpenses } from "@/lib/insurance-policies/premium-expense";
import type {
  Account,
  ClientData,
  ClientInfo,
  Expense,
  LifeInsurancePolicy,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

// ── Factories ──────────────────────────────────────────────────────────────

const SINGLE_CLIENT: ClientInfo = {
  firstName: "Solo",
  lastName: "Client",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "single",
};

const BASE_PLAN: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  planStartYear: 2025,
  planEndYear: 2050,
};

function mkPolicyAccount(
  id: string,
  policyOver: Partial<LifeInsurancePolicy>,
  acctOver: Partial<Account> = {},
): Account {
  const policy: LifeInsurancePolicy = {
    faceValue: 1_000_000,
    costBasis: 0,
    premiumAmount: 0,
    premiumYears: null,
    policyType: "whole",
    termIssueYear: null,
    termLengthYears: null,
    endsAtInsuredRetirement: false,
    cashValueGrowthMode: "basic",
    postPayoutMergeAccountId: null,
    postPayoutGrowthRate: 0.04,
    cashValueSchedule: [],
    ...policyOver,
  };
  return {
    id,
    name: `Policy ${id}`,
    category: "life_insurance",
    subType: policy.policyType,
    insuredPerson: "client",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    lifeInsurance: policy,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...acctOver,
  };
}

function mkClientData(over: Partial<ClientData>): ClientData {
  return {
    client: SINGLE_CLIENT,
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: BASE_PLAN,
    ...over,
  };
}

// ── 1. Term expiry — insured outlives term, no payout at later death ─────

describe("life insurance — term expiry before death", () => {
  it("drops the term policy after the last in-force year and never pays out at a later death", () => {
    // Fixed 10-year term issued 2025 → in-force through 2034; expires 2035.
    // Client born 1980, dies 2070 (lifeExpectancy = 90) — long after term expiry.
    const client: ClientInfo = {
      ...SINGLE_CLIENT,
      dateOfBirth: "1980-01-01",
      lifeExpectancy: 90, // dies in 2070
    };
    const policy = mkPolicyAccount(
      "pol-term",
      {
        policyType: "term",
        termIssueYear: 2025,
        termLengthYears: 10,
        faceValue: 1_000_000,
      },
      {
        insuredPerson: "client",
        value: 0,
      },
    );

    const data = mkClientData({
      client,
      accounts: [policy],
      planSettings: { ...BASE_PLAN, planStartYear: 2025, planEndYear: 2070 },
    });

    const years = runProjection(data);
    const byYear = new Map(years.map((y) => [y.year, y]));

    // Policy is still in-force in 2034 (last year of the fixed term).
    const y2034 = byYear.get(2034);
    expect(y2034).toBeDefined();
    expect(y2034!.portfolioAssets.lifeInsurance["pol-term"]).toBeDefined();

    // Year 2035: term expiry filter fires mid-iteration (projection.ts
    // lines 486-502).  The filter runs AFTER the per-year ledger init, so
    // the 2035 ledger exists with a zero beginning balance; the policy is
    // then removed from workingAccounts and from accountBalances.  From
    // 2036 onward the policy is entirely absent.
    const y2035 = byYear.get(2035);
    expect(y2035).toBeDefined();
    expect(y2035!.portfolioAssets.lifeInsurance["pol-term"]).toBeUndefined();

    for (const y of years.filter((y) => y.year >= 2036)) {
      expect(y.portfolioAssets.lifeInsurance["pol-term"]).toBeUndefined();
      expect(y.accountLedgers["pol-term"]).toBeUndefined();
    }

    // No deathTransfer ever sources from the expired term policy.
    for (const y of years) {
      for (const t of y.deathTransfers ?? []) {
        expect(t.sourceAccountId).not.toBe("pol-term");
      }
    }

    // Final-death year (2070): the policy expired 35 years earlier. Nothing
    // should be included in the gross estate for it.
    const y2070 = byYear.get(2070);
    expect(y2070).toBeDefined();
    expect(y2070!.estateTax).toBeDefined();
    const policyLine = y2070!.estateTax!.grossEstateLines.find(
      (l) => l.accountId === "pol-term",
    );
    expect(policyLine).toBeUndefined();
  });
});

// ── 2. Term retirement-based expiry — endsAtInsuredRetirement ────────────

describe("life insurance — endsAtInsuredRetirement", () => {
  it("drops the term policy the year after the insured's retirement year", () => {
    // Client born 1980, retirementAge 65 → retires 2045.
    // Policy ends at insured retirement; in-force through 2045, gone 2046.
    const client: ClientInfo = {
      ...SINGLE_CLIENT,
      dateOfBirth: "1980-01-01",
      retirementAge: 65,
    };
    const policy = mkPolicyAccount(
      "pol-ret",
      {
        policyType: "term",
        termIssueYear: 2025,
        termLengthYears: null,
        endsAtInsuredRetirement: true,
        faceValue: 500_000,
        premiumAmount: 0,
      },
      { insuredPerson: "client", value: 0 },
    );

    // Sanity-check the helper directly — matches the plan sample.
    expect(
      computeTermEndYear({ policy: policy.lifeInsurance!, insured: "client", client }),
    ).toBe(2045);

    const data = mkClientData({
      client,
      accounts: [policy],
      planSettings: { ...BASE_PLAN, planStartYear: 2025, planEndYear: 2070 },
    });
    const years = runProjection(data);
    const byYear = new Map(years.map((y) => [y.year, y]));

    // 2045 — retirement year, still in-force.
    expect(byYear.get(2045)!.portfolioAssets.lifeInsurance["pol-ret"]).toBeDefined();
    expect(byYear.get(2045)!.accountLedgers["pol-ret"]).toBeDefined();

    // 2046 — first post-expiry year.  The filter drops the policy from
    // portfolioAssets immediately, but the per-year ledger was initialized
    // (with a zero beginning balance) before the filter ran.  From 2047 on
    // the policy is fully absent.
    expect(byYear.get(2046)!.portfolioAssets.lifeInsurance["pol-ret"]).toBeUndefined();
    expect(byYear.get(2047)!.portfolioAssets.lifeInsurance["pol-ret"]).toBeUndefined();
    expect(byYear.get(2047)!.accountLedgers["pol-ret"]).toBeUndefined();
  });

  it("endsAtInsuredRetirement still bills premiums every year the synthesized expense is active", () => {
    // 20-year term fallback (termLengthYears: null) coincidentally ends in
    // 2044, before the 2045 retirement year, so the retirement cap doesn't
    // change anything in this fixture. The next test exercises the cap
    // directly with an explicit premiumYears value.
    const client: ClientInfo = {
      ...SINGLE_CLIENT,
      dateOfBirth: "1980-01-01",
      retirementAge: 65,
      lifeExpectancy: 95,
    };
    const policy = mkPolicyAccount(
      "pol-ret2",
      {
        policyType: "term",
        termIssueYear: 2025,
        termLengthYears: null,
        endsAtInsuredRetirement: true,
        faceValue: 500_000,
        premiumAmount: 1_000,
      },
      { insuredPerson: "client", value: 0 },
    );

    const synthesized = synthesizePremiumExpenses({
      currentYear: 2025,
      accounts: [policy],
      clientBirthYear: 1980,
      spouseBirthYear: null,
      clientRetirementAge: 65,
      spouseRetirementAge: null,
      lifeExpectancyClient: 95,
      lifeExpectancySpouse: null,
    });
    expect(synthesized).toHaveLength(1);
    // 20-year fallback: 2025..2044.
    expect(synthesized[0].startYear).toBe(2025);
    expect(synthesized[0].endYear).toBe(2044);

    const data = mkClientData({
      client,
      accounts: [policy],
      expenses: synthesized,
      planSettings: { ...BASE_PLAN, planStartYear: 2025, planEndYear: 2050 },
    });
    const years = runProjection(data);
    const byYear = new Map(years.map((y) => [y.year, y]));
    const expenseId = `premium-${policy.id}`;

    // In-range years 2025..2044 — premium billed every year.
    for (let yr = 2025; yr <= 2044; yr++) {
      expect(byYear.get(yr)!.expenses.bySource[expenseId]).toBeCloseTo(1_000, 6);
    }
    // After the synthesized expense's endYear — no more premium.
    for (let yr = 2045; yr <= 2050; yr++) {
      expect(byYear.get(yr)!.expenses.bySource[expenseId] ?? 0).toBe(0);
    }
  });

  it("caps premium billing at the insured's retirement year when endsAtInsuredRetirement is set, even with an explicit premiumYears that outlives retirement", () => {
    // Client born 1980, retires at 65 → retires 2045. Term policy with
    // endsAtInsuredRetirement AND explicit premiumYears=30 would otherwise
    // bill 2025..2054 (9 years past retirement). The retirement cap should
    // win: bill 2025..2045.
    const client: ClientInfo = {
      ...SINGLE_CLIENT,
      dateOfBirth: "1980-01-01",
      retirementAge: 65,
      lifeExpectancy: 95,
    };
    const policy = mkPolicyAccount(
      "pol-ret-cap",
      {
        policyType: "term",
        termIssueYear: 2025,
        termLengthYears: null,
        endsAtInsuredRetirement: true,
        premiumYears: 30,
        faceValue: 500_000,
        premiumAmount: 2_000,
      },
      { insuredPerson: "client", value: 0 },
    );

    const synthesized = synthesizePremiumExpenses({
      currentYear: 2025,
      accounts: [policy],
      clientBirthYear: 1980,
      spouseBirthYear: null,
      clientRetirementAge: 65,
      spouseRetirementAge: null,
      lifeExpectancyClient: 95,
      lifeExpectancySpouse: null,
    });
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0].startYear).toBe(2025);
    // Capped at retirement year 2045 — NOT 2054 (= startYear + 30 - 1).
    expect(synthesized[0].endYear).toBe(2045);

    const data = mkClientData({
      client,
      accounts: [policy],
      expenses: synthesized,
      planSettings: { ...BASE_PLAN, planStartYear: 2025, planEndYear: 2055 },
    });
    const years = runProjection(data);
    const byYear = new Map(years.map((y) => [y.year, y]));
    const expenseId = `premium-${policy.id}`;

    for (let yr = 2025; yr <= 2045; yr++) {
      expect(byYear.get(yr)!.expenses.bySource[expenseId]).toBeCloseTo(2_000, 6);
    }
    // Past retirement — no premium.
    for (let yr = 2046; yr <= 2055; yr++) {
      expect(byYear.get(yr)!.expenses.bySource[expenseId] ?? 0).toBe(0);
    }
  });
});

// ── 3. Cash-value schedule (free-form) overrides growth rate ─────────────

describe("life insurance — free-form cash-value schedule", () => {
  it("uses schedule rows for in-force years, flat-forwards past the last row", () => {
    // postPayoutGrowthRate is set to a wild value to prove it is NOT used
    // for in-force growth (it's only used after a payout transform).
    const policy = mkPolicyAccount(
      "pol-cv",
      {
        policyType: "whole",
        cashValueGrowthMode: "free_form",
        cashValueSchedule: [
          { year: 2025, cashValue: 10_000 },
          { year: 2026, cashValue: 15_000 },
          { year: 2027, cashValue: 22_000 },
        ],
        postPayoutGrowthRate: 0.99,
        faceValue: 1_000_000,
      },
      { insuredPerson: "client", value: 10_000, growthRate: 0.5 },
    );

    const data = mkClientData({
      accounts: [policy],
      planSettings: { ...BASE_PLAN, planStartYear: 2025, planEndYear: 2030 },
    });

    const years = runProjection(data);
    const byYear = new Map(years.map((y) => [y.year, y]));

    // Exact schedule rows for 2025/2026/2027 — NOT value * (1 + 0.5 or 0.99).
    expect(byYear.get(2025)!.portfolioAssets.lifeInsurance["pol-cv"]).toBeCloseTo(
      10_000,
      6,
    );
    expect(byYear.get(2026)!.portfolioAssets.lifeInsurance["pol-cv"]).toBeCloseTo(
      15_000,
      6,
    );
    expect(byYear.get(2027)!.portfolioAssets.lifeInsurance["pol-cv"]).toBeCloseTo(
      22_000,
      6,
    );

    // After the schedule runs out, the engine's behavior is "flat-forward at
    // the last row's value" (resolveCashValueForYear in
    // src/engine/life-insurance-schedule.ts, line 23-25).  The schedule is
    // still authoritative — the postPayoutGrowthRate is never applied.
    expect(byYear.get(2028)!.portfolioAssets.lifeInsurance["pol-cv"]).toBeCloseTo(
      22_000,
      6,
    );
    expect(byYear.get(2029)!.portfolioAssets.lifeInsurance["pol-cv"]).toBeCloseTo(
      22_000,
      6,
    );
    expect(byYear.get(2030)!.portfolioAssets.lifeInsurance["pol-cv"]).toBeCloseTo(
      22_000,
      6,
    );
  });
});

// ── 4/5. Premium expense synthesis + premiumYears cap ────────────────────

describe("life insurance — premium expenses", () => {
  it("emits a premium expense for exactly premiumYears years (10), capped thereafter", () => {
    const policy = mkPolicyAccount(
      "pol-premium",
      {
        policyType: "whole",
        termIssueYear: 2025,
        premiumAmount: 10_000,
        premiumYears: 10,
      },
      { insuredPerson: "client", value: 0 },
    );

    const synthesized = synthesizePremiumExpenses({
      currentYear: 2025,
      accounts: [policy],
      clientBirthYear: 1980,
      spouseBirthYear: null,
      clientRetirementAge: 65,
      spouseRetirementAge: null,
      lifeExpectancyClient: 95,
      lifeExpectancySpouse: null,
    });

    expect(synthesized).toHaveLength(1);
    const exp: Expense = synthesized[0];
    // Task 11 contract: source + sourcePolicyAccountId carry the provenance.
    expect(exp.source).toBe("policy");
    expect(exp.sourcePolicyAccountId).toBe("pol-premium");
    expect(exp.id).toBe("premium-pol-premium");
    expect(exp.startYear).toBe(2025);
    expect(exp.endYear).toBe(2034); // startYear + premiumYears - 1

    const data = mkClientData({
      accounts: [policy],
      expenses: synthesized,
      planSettings: { ...BASE_PLAN, planStartYear: 2025, planEndYear: 2050 },
    });

    const years = runProjection(data);
    const byYear = new Map(years.map((y) => [y.year, y]));
    const expenseId = "premium-pol-premium";

    // 2025..2034 — 10 years, each $10,000 (growthRate=0, no inflation).
    let total = 0;
    for (let yr = 2025; yr <= 2034; yr++) {
      const amt = byYear.get(yr)!.expenses.bySource[expenseId];
      expect(amt).toBeDefined();
      expect(amt).toBeCloseTo(10_000, 6);
      total += amt!;
    }
    expect(total).toBeCloseTo(100_000, 6);

    // 2035 onward — no more premium expense.
    for (let yr = 2035; yr <= 2050; yr++) {
      const amt = byYear.get(yr)!.expenses.bySource[expenseId] ?? 0;
      expect(amt).toBe(0);
    }
  });

  it("premiumYears=null on a permanent policy bills every year through the insured's lifespan", () => {
    // Permanent (whole-life), no paid-up horizon — premium runs until the
    // insured's projected lifespan year (clientBirthYear + lifeExpectancy).
    // With lifeExpectancy=95 and birthYear=1980, lifespan year = 2075.
    // Plan ends in 2050 so we simply verify every plan year is billed.
    const policy = mkPolicyAccount(
      "pol-perm",
      {
        policyType: "whole",
        termIssueYear: 2025, // used as issue year fallback for startYear
        premiumAmount: 7_500,
        premiumYears: null,
      },
      { insuredPerson: "client", value: 0 },
    );

    const synthesized = synthesizePremiumExpenses({
      currentYear: 2025,
      accounts: [policy],
      clientBirthYear: 1980,
      spouseBirthYear: null,
      clientRetirementAge: 65,
      spouseRetirementAge: null,
      lifeExpectancyClient: 95,
      lifeExpectancySpouse: null,
    });
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0].startYear).toBe(2025);
    expect(synthesized[0].endYear).toBe(2075); // lifespan year

    const data = mkClientData({
      accounts: [policy],
      expenses: synthesized,
      planSettings: { ...BASE_PLAN, planStartYear: 2025, planEndYear: 2050 },
    });

    const years = runProjection(data);
    const expenseId = "premium-pol-perm";

    // Every year 2025..2050 gets the full premium (growthRate=0, inflation=0).
    for (const y of years) {
      const amt = y.expenses.bySource[expenseId];
      expect(amt).toBeCloseTo(7_500, 6);
    }
  });
});
