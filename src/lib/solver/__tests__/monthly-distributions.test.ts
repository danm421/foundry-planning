import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import {
  baseClient,
  basePlanSettings,
  buildClientData,
  sampleAccounts,
  sampleFamilyMembers,
} from "@/engine/__tests__/fixtures";
import {
  BORROWER,
  CHECKING as MARGIN_CHECKING,
  spending,
} from "@/engine/__tests__/_fixtures/margin";
import {
  FIRST_DEATH_YEAR,
  JANE_INHERITED_ROTH,
  iraSplitAtFirstDeath,
  iraToTrustAtFirstDeath,
} from "@/engine/__tests__/_fixtures/survivor-iras";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import type { Account, ClientData, Expense, Income, ProjectionYear } from "@/engine/types";
import { buildMonthlyCashFlowRows, deflator, type DollarBasis } from "../monthly-cash-flow";
import {
  buildDistributionMonths,
  buildMonthlyDistributionRows,
  hasOtherAccounts,
  isRetirementYear,
  MIN_LINE_PER_MONTH,
  rankDistributionAccounts,
  type DistributionRow,
} from "../monthly-distributions";

/** Without an `isDefaultChecking` account the engine skips the whole surplus
 *  phase, so discretionary spend, saved surplus and the absorb lever never run.
 *  Shape copied from `monthly-cash-flow-split.test.ts`. */
const defaultChecking: Account = {
  id: "acct-checking",
  name: "Joint Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 10_000,
  basis: 10_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const withChecking = (accounts: Account[] = sampleAccounts): Account[] => [
  defaultChecking,
  ...accounts,
];

/** The base fixture's 401(k) as a Traditional IRA (as in the engine's
 *  `distribution-detail.test.ts`): a 401(k)'s basis never joins the Form 8606
 *  pool, so only an IRA carries after-tax basis into its RMD. */
function accountsWithIra(basis: number): Account[] {
  return withChecking(
    sampleAccounts.map((a) =>
      a.id === "acct-401k" ? { ...a, name: "John IRA", subType: "traditional_ira", basis } : a,
    ),
  );
}

const living: Expense = {
  id: "exp-living",
  type: "living",
  name: "Living Expenses",
  annualAmount: 80_000,
  startYear: 2026,
  endYear: 2055,
  growthRate: 0.03,
};

const absorbingLiving: Expense = { ...living, absorbsRemainingCashFlow: true };

/** Same tolerance, same reason, as `RESIDUAL_TOLERANCE_PER_YEAR` in
 *  `monthly-cash-flow-split.test.ts`: the engine's checking gap-fill leaves a
 *  few dollars of residue in the year the cushion runs dry. A dropped or
 *  double-counted bucket is thousands. */
const RESIDUAL_TOLERANCE_PER_YEAR = 10;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);


/** Float noise allowed below zero on a need line, per month. */
const NEED_EPSILON = 0.01;

function build(clientData: ClientData, basis: DollarBasis = "nominal") {
  const years = runProjection(clientData);
  return { years, rows: buildMonthlyDistributionRows(years, clientData, basis) };
}

/** Income + Σ account draws = need + taxes + goal costs paid from general
 *  accounts + surplus spent + spend-whatever's-left extra + kept, every year. */
function expectCloses(rows: DistributionRow[]) {
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    const { fromAccounts } = r;
    expect(Math.abs(fromAccounts.unexplained * 12), `${r.year} unexplained`).toBeLessThan(
      RESIDUAL_TOLERANCE_PER_YEAR,
    );
    // R1: the card's account lines, the table columns and the chart stack all
    // add to the same figure.
    expect(sum(fromAccounts.accounts.map((a) => a.amount))).toBeCloseTo(fromAccounts.total, 6);
    // A line is real money: never ≤ 0, and never float dust that would print
    // as "$0" (the engine leaves ~1e-12 on checking in some years).
    for (const a of fromAccounts.accounts) {
      expect(a.amount, `${r.year} ${a.name}`).toBeGreaterThanOrEqual(MIN_LINE_PER_MONTH);
    }
    // Every need line is money the household spends. A negative one means the
    // builder took out something that was never in it — which the closing
    // check alone cannot see when the same amount is over-added elsewhere.
    const { living, liabilities, realEstate, insurance, other, savings } = r.need;
    const needLines = { living, liabilities, realEstate, insurance, other, savings };
    for (const [name, v] of Object.entries(needLines)) {
      expect(v, `${r.year} need.${name}`).toBeGreaterThanOrEqual(-NEED_EPSILON);
    }
    for (const l of r.need.goalLines) expect(l.amount).toBeGreaterThan(0);
    // The waterfall's parts are what the account money paid for, so they add
    // to it too (up to the same residue).
    expect(
      Math.abs((sum(Object.values(fromAccounts.parts)) - fromAccounts.total) * 12),
      `${r.year} parts`,
    ).toBeLessThan(RESIDUAL_TOLERANCE_PER_YEAR);
  }
}

/** The base fixture with default checking plus one more expense (and accounts). */
function withGoal(goal: Expense, extraAccounts: Account[] = []): ClientData {
  const base = buildClientData({ accounts: [...withChecking(), ...extraAccounts] });
  return { ...base, expenses: [...base.expenses, goal] };
}

/** Shape: the engine's "RMD on a fully-entity-owned IRA" test (projection.test.ts):
 *  a 76-year-old single client with her own IRA, plus a trust-owned IRA whose
 *  RMD routes to the trust's checking. */
function entityIraClientData(): ClientData {
  const ira = (id: string, name: string, owners: Account["owners"]): Account => ({
    id,
    name,
    category: "retirement",
    subType: "traditional_ira",
    titlingType: "jtwros",
    value: 500_000,
    basis: 0,
    growthRate: 0,
    rmdEnabled: true,
    owners,
  });
  const client = [
    { kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
  ];
  const trust = [{ kind: "entity" as const, entityId: "ngt", percent: 1 }];
  return buildClientData({
    client: {
      firstName: "Trust",
      lastName: "Test",
      dateOfBirth: "1950-01-01",
      filingStatus: "single",
      retirementAge: 65,
      planEndAge: 95,
    },
    familyMembers: [{ ...sampleFamilyMembers[0], dateOfBirth: "1950-01-01" }],
    accounts: [
      { ...defaultChecking, value: 100_000, basis: 100_000 },
      {
        ...defaultChecking,
        id: "acct-trust-checking",
        name: "Trust Checking",
        value: 0,
        basis: 0,
        owners: trust,
      },
      ira("acct-trust-ira", "Trust IRA", trust),
      ira("acct-ira", "Client IRA", client),
    ],
    incomes: [],
    expenses: [{ ...living, annualAmount: 60_000 }],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [
      { accountId: "acct-ira", priorityOrder: 1, startYear: 2026, endYear: 2030 },
    ],
    planSettings: { ...basePlanSettings, planEndYear: 2030 },
    entities: [{ id: "ngt", name: "NGT", includeInPortfolio: false, isGrantor: false }],
  });
}

/** A hand-built row carrying only account lines — enough for the ranking. */
function rowWithAccounts(lines: [string, number][]): DistributionRow {
  return {
    year: 2040,
    ageLabel: "Age 70",
    retired: true,
    depleted: false,
    need: {
      living: 0,
      liabilities: 0,
      realEstate: 0,
      insurance: 0,
      goalLines: [],
      other: 0,
      savings: 0,
      total: 0,
    },
    income: { total: 0, sources: [] },
    taxes: 0,
    fromAccounts: {
      total: sum(lines.map(([, a]) => a)),
      accounts: lines.map(([id, amount]) => ({
        accountId: id,
        name: id.toUpperCase(),
        amount,
        annualNominal: amount * 12,
        borrowed: 0,
      })),
      parts: {
        spending: 0,
        taxes: 0,
        goalShortfall: 0,
        surplusSpent: 0,
        absorbedExtra: 0,
        keptOrReinvested: 0,
      },
      unexplained: 0,
    },
    goals: [],
    qcds: [],
    lifeInsuranceProceeds: 0,
  };
}

describe("monthly distributions", () => {
  it("closes every year", () => {
    const { rows } = build(buildClientData({ accounts: withChecking() }));
    expectCloses(rows);
  });

  it.each<[string, ClientData, (years: ProjectionYear[]) => boolean]>([
    [
      "an RMD",
      buildClientData({ accounts: accountsWithIra(0) }),
      (years) => years.some((y) => (y.distributionDetail?.rmdInTotalIncome ?? 0) > 0),
    ],
    [
      "an absorb lever",
      buildClientData({ accounts: withChecking(), expenses: [absorbingLiving] }),
      (years) => years.some((y) => (y.distributionDetail?.absorbedSurplus ?? 0) > 0),
    ],
    [
      "spend-100%-of-surplus",
      buildClientData({
        accounts: withChecking(),
        planSettings: { ...basePlanSettings, surplusSpendPct: 1 },
      }),
      (years) => years.some((y) => y.expenses.discretionary > 0),
    ],
    [
      "save-to-account",
      buildClientData({
        accounts: withChecking(),
        planSettings: {
          ...basePlanSettings,
          surplusSpendPct: 0,
          surplusSaveAccountId: "acct-brokerage",
        },
      }),
      (years) =>
        years.some((y) =>
          (y.accountLedgers["acct-brokerage"]?.entries ?? []).some(
            (e) => e.category === "surplus_transfer" && e.amount > 0,
          ),
        ),
    ],
  ])(
    "closes with an RMD, an absorb lever, spend-100%-of-surplus and save-to-account: %s",
    (_, clientData, live) => {
      const { years, rows } = build(clientData);
      // Liveness: the fixture really exercises the path it is named for.
      expect(live(years)).toBe(true);
      expectCloses(rows);
    },
  );

  it.each<[string, ClientData, (years: ProjectionYear[], rows: DistributionRow[]) => boolean]>([
    [
      "a death (survivor years)",
      buildClientData({
        accounts: withChecking(),
        client: { ...baseClient, lifeExpectancy: 80, spouseLifeExpectancy: 85 },
      }),
      // John (1970) dies in 2050; Jane lives on to the plan's end.
      (years) =>
        years.some((y) => (y.deathTransfers ?? []).length > 0) && years.some((y) => y.year > 2050),
    ],
    [
      "an entity-owned IRA taking an RMD",
      entityIraClientData(),
      // The trust's RMD is stamped on its ledger, but its cash goes to the
      // trust — so it never becomes a household account line.
      (years, rows) =>
        years[0].accountLedgers["acct-trust-ira"].rmdAmount > 0 &&
        rows.every((r) => r.fromAccounts.accounts.every((a) => a.accountId !== "acct-trust-ira")),
    ],
    [
      "a set-aside goal paying its shortfall out of pocket",
      withGoal({
        id: "boat",
        type: "other",
        name: "Boat",
        annualAmount: 200_000,
        startYear: 2040,
        endYear: 2040,
        growthRate: 0,
        isGoal: true,
        dedicatedAccountIds: ["acct-savings"],
        payShortfallOutOfPocket: true,
      }),
      (_, rows) => rows.some((r) => r.fromAccounts.parts.goalShortfall > 0),
    ],
    [
      "an education goal paid from a 529",
      withGoal(
        {
          id: "college",
          type: "education",
          name: "College",
          annualAmount: 30_000,
          startYear: 2030,
          endYear: 2033,
          growthRate: 0.03,
          dedicatedAccountIds: ["acct-529"],
          payShortfallOutOfPocket: true,
        },
        [
          {
            id: "acct-529",
            name: "Kid 529",
            category: "education_savings",
            subType: "529",
            titlingType: "jtwros",
            value: 50_000,
            basis: 40_000,
            growthRate: 0.05,
            rmdEnabled: false,
            owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
          },
        ],
      ),
      // R2: the 529 pays without touching household money, so its draw is
      // shown on the goal but never taken out of the need.
      (years) =>
        years.some((y) =>
          y.goals?.some((g) => g.dedicatedWithdrawal > 0 && g.householdWithdrawal === 0),
        ),
    ],
  ])("also closes with %s", (_, clientData, live) => {
    const { years, rows } = build(clientData);
    expect(live(years, rows)).toBe(true);
    expectCloses(rows);
  });

  it("RMD cash moves from income to its IRA", () => {
    // After-tax basis: `totalIncome` carries only the taxable slice of the RMD
    // while the ledger's `rmdAmount` is the whole cash (Review Focus 5).
    const { years, rows } = build(buildClientData({ accounts: accountsWithIra(100_000) }));
    const i = years.findIndex((y) => (y.accountLedgers["acct-401k"]?.rmdAmount ?? 0) > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const y = years[i];
    const r = rows[i];
    const rmdAmount = y.accountLedgers["acct-401k"].rmdAmount;
    const rmdInTotalIncome = y.distributionDetail!.rmdInTotalIncome;
    expect(rmdInTotalIncome).toBeGreaterThan(0);
    expect(rmdInTotalIncome).toBeLessThan(rmdAmount);

    expect(r.income.total * 12).toBeCloseTo(y.totalIncome - rmdInTotalIncome, 4);
    const ira = r.fromAccounts.accounts.find((a) => a.accountId === "acct-401k");
    expect(ira?.name).toBe("John IRA");
    expect(ira!.amount * 12).toBeGreaterThanOrEqual(rmdAmount - 0.01);
    expectCloses(rows);
  });

  it("set-aside goal is outside the need and the account draws", () => {
    const car: Expense = {
      id: "car",
      type: "other",
      name: "New car",
      annualAmount: 40_000,
      startYear: 2030,
      endYear: 2030,
      growthRate: 0,
      isGoal: true,
      dedicatedAccountIds: ["acct-brokerage"],
      payShortfallOutOfPocket: false,
    };
    const base = buildClientData({ accounts: withChecking() });
    const { years, rows } = build({ ...base, expenses: [...base.expenses, car] });
    const i = years.findIndex((y) => y.year === 2030);
    const y = years[i];
    const r = rows[i];
    const goal = y.goals!.find((g) => g.goalId === "car")!;
    expect(goal.householdWithdrawal).toBeGreaterThan(0);

    expect(r.goals).toHaveLength(1);
    expect(r.goals[0]).toMatchObject({
      goalId: "car",
      name: "New car",
      setAsideAccountNames: ["Joint Brokerage"],
    });
    expect(r.goals[0].fromSetAside).toBeGreaterThan(0);
    expect(r.goals[0].fromSetAside * 12).toBeCloseTo(goal.dedicatedWithdrawal, 4);

    // The goal's cost really sat inside `expenses.other`; the need takes it out.
    expect(y.expenses.bySource["car"]).toBeCloseTo(goal.householdWithdrawal, 4);
    expect(r.need.other * 12).toBeCloseTo(
      y.expenses.other - goal.householdWithdrawal - goal.outOfPocketWithdrawal,
      4,
    );
    expect(r.need.goalLines).toEqual([]);

    // The brokerage line leaves the goal draw out.
    const draw = y.distributionDetail!.goalDrawsByAccount["acct-brokerage"];
    expect(draw).toBeGreaterThan(0);
    const line = r.fromAccounts.accounts.find((a) => a.accountId === "acct-brokerage");
    expect((line?.amount ?? 0) * 12).toBeCloseTo(
      y.withdrawals.byAccount["acct-brokerage"] - draw,
      4,
    );
    expectCloses(rows);
  });

  it("an entity-owned goal's out-of-pocket part stays off the household view", () => {
    // A trust-owned $100k education goal with $20k set aside in a trust
    // brokerage and out-of-pocket on: the engine reports an 80k out-of-pocket
    // part, but the trust's own checking pays it — nothing enters
    // `expenses.other`.
    const trust = [{ kind: "entity" as const, entityId: "ngt", percent: 1 }];
    const clientData: ClientData = {
      ...withGoal(
        {
          id: "trust-college",
          type: "education",
          name: "Trust college",
          annualAmount: 100_000,
          startYear: 2030,
          endYear: 2030,
          growthRate: 0,
          dedicatedAccountIds: ["acct-trust-brokerage"],
          payShortfallOutOfPocket: true,
          ownerEntityId: "ngt",
        },
        [
          {
            ...defaultChecking,
            id: "acct-trust-checking",
            name: "Trust Checking",
            value: 500_000,
            basis: 500_000,
            owners: trust,
          },
          {
            ...defaultChecking,
            id: "acct-trust-brokerage",
            name: "Trust Brokerage",
            category: "taxable",
            subType: "brokerage",
            isDefaultChecking: false,
            value: 20_000,
            basis: 20_000,
            owners: trust,
          },
        ],
      ),
      entities: [{ id: "ngt", name: "NGT", includeInPortfolio: false, isGrantor: false }],
    };
    const { years, rows } = build(clientData);
    const i = years.findIndex((y) => y.year === 2030);
    const y = years[i];
    const r = rows[i];
    const goal = y.goals!.find((g) => g.goalId === "trust-college")!;
    // Liveness: an out-of-pocket part the household never paid.
    expect(goal.outOfPocketWithdrawal).toBeGreaterThan(0);
    expect(y.expenses.bySource["trust-college"]).toBeUndefined();
    // First, so the closing helper's own need-line guard is what catches an
    // over-subtraction: it cancels against `goalShortfall` and still closes.
    expectCloses(rows);

    const line = r.goals.find((g) => g.goalId === "trust-college")!;
    expect(line.setAsideAccountNames).toEqual(["Trust Brokerage"]);
    expect(line.fromSetAside * 12).toBeCloseTo(goal.dedicatedWithdrawal, 4);
    expect(line.fromGeneral).toBe(0);
    expect(r.need.other * 12).toBeCloseTo(y.expenses.other, 4);
    expect(r.fromAccounts.parts.goalShortfall).toBe(0);
  });

  it("an out-of-pocket part with no checking to pay it is not from general accounts", () => {
    // No default checking: the engine's out-of-pocket spill has no account to
    // leave from, so only the set-aside draw is booked in `expenses.other`.
    const base = buildClientData();
    expect(base.accounts.some((a) => a.isDefaultChecking)).toBe(false);
    const boat: Expense = {
      id: "boat",
      type: "other",
      name: "Boat",
      annualAmount: 200_000,
      startYear: 2030,
      endYear: 2030,
      growthRate: 0,
      isGoal: true,
      dedicatedAccountIds: ["acct-savings"],
      payShortfallOutOfPocket: true,
    };
    const { years, rows } = build({ ...base, expenses: [...base.expenses, boat] });
    const i = years.findIndex((y) => y.year === 2030);
    const y = years[i];
    const goal = y.goals!.find((g) => g.goalId === "boat")!;
    expect(goal.outOfPocketWithdrawal).toBeGreaterThan(0);
    expect(goal.householdWithdrawal).toBeGreaterThan(0);
    expect(y.expenses.bySource["boat"]).toBeCloseTo(goal.householdWithdrawal, 4);

    expect(rows[i].goals[0].fromGeneral).toBe(0);
    expect(rows[i].need.other * 12).toBeCloseTo(
      y.expenses.other - goal.householdWithdrawal,
      4,
    );
    expect(rows[i].need.other).toBeGreaterThanOrEqual(-NEED_EPSILON);
  });

  it("a goal with no set-aside account is a named need line", () => {
    const remodel: Expense = {
      id: "remodel",
      type: "other",
      name: "Kitchen remodel",
      annualAmount: 30_000,
      startYear: 2031,
      endYear: 2031,
      growthRate: 0,
      isGoal: true,
    };
    const base = buildClientData({ accounts: withChecking() });
    const { years, rows } = build({ ...base, expenses: [...base.expenses, remodel] });
    const i = years.findIndex((y) => y.year === 2031);
    const y = years[i];
    const r = rows[i];
    const cost = y.expenses.bySource["remodel"];
    expect(cost).toBeGreaterThan(0);

    expect(r.need.goalLines).toHaveLength(1);
    expect(r.need.goalLines[0]).toMatchObject({ expenseId: "remodel", name: "Kitchen remodel" });
    expect(r.need.goalLines[0].amount * 12).toBeCloseTo(cost, 4);
    expect(r.need.other * 12).toBeCloseTo(y.expenses.other - cost, 4);
    expect(r.goals).toEqual([]);
    // Other years carry no line for it.
    expect(rows[i - 1].need.goalLines).toEqual([]);
    expectCloses(rows);
  });

  it("absorbed extra is not in the need", () => {
    const { years, rows } = build(
      buildClientData({ accounts: withChecking(), expenses: [absorbingLiving] }),
    );
    expect(rows[0].year).toBe(2026);
    expect(years[0].distributionDetail!.absorbedSurplus).toBeGreaterThan(0);
    expect(rows[0].need.living * 12).toBeCloseTo(80_000, 2);
    expect(rows.some((r) => r.fromAccounts.parts.absorbedExtra > 0)).toBe(true);
    expectCloses(rows);
  });

  it("income above the need flows down the waterfall", () => {
    const { years, rows } = build(buildClientData({ accounts: withChecking() }));
    // 2026: both still drawing salary.
    expect(years[0].income.salaries).toBeGreaterThan(0);
    const r = rows[0];
    expect(r.retired).toBe(false);
    expect(r.income.total).toBeGreaterThan(r.need.total);
    expect(r.fromAccounts.parts.spending).toBe(0);
    for (const row of rows) {
      for (const v of Object.values(row.fromAccounts.parts)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("depleted matches the Cash flow view", () => {
    const clientData = buildClientData({
      accounts: withChecking(),
      expenses: [{ ...living, annualAmount: 400_000 }],
    });
    const years = runProjection(clientData);
    const rows = buildMonthlyDistributionRows(years, clientData, "nominal");
    const cashFlowRows = buildMonthlyCashFlowRows(years, clientData, "nominal");
    expect(rows.map((r) => r.depleted)).toEqual(cashFlowRows.map((r) => r.depleted));
    expect(rows.some((r) => r.depleted)).toBe(true);
  });

  it("QCD shows as a note, outside every total", () => {
    const CHARITY_ID = "00000000-0000-0000-0000-000000000aaa";
    // Shape: src/engine/__tests__/projection-qcd.test.ts — a single client of
    // 75 with a $1M IRA, giving $5,000 of the 2026 RMD straight to charity.
    const clientData = buildClientData({
      client: {
        firstName: "Qcd",
        lastName: "Test",
        dateOfBirth: "1951-01-01",
        filingStatus: "single",
        retirementAge: 65,
        planEndAge: 95,
      },
      familyMembers: [{ ...sampleFamilyMembers[0], dateOfBirth: "1951-01-01" }],
      accounts: [
        { ...defaultChecking, value: 50_000, basis: 50_000 },
        {
          id: "acct-ira",
          name: "Client IRA",
          category: "retirement",
          subType: "traditional_ira",
          titlingType: "jtwros",
          value: 1_000_000,
          basis: 0,
          growthRate: 0,
          rmdEnabled: true,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [{ ...living, annualAmount: 60_000 }],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [
        { accountId: "acct-ira", priorityOrder: 1, startYear: 2026, endYear: 2030 },
      ],
      planSettings: { ...basePlanSettings, planEndYear: 2030 },
      qcds: [
        { year: 2026, accountId: "acct-ira", charityId: CHARITY_ID, mode: "fixed", amount: 5_000 },
      ],
      externalBeneficiaries: [
        { id: CHARITY_ID, name: "Stanford", kind: "charity", charityType: "public" },
      ],
    });
    const { years, rows } = build(clientData);
    const r = rows[0];
    expect(r.year).toBe(2026);
    expect(r.qcds).toHaveLength(1);
    expect(r.qcds[0]).toMatchObject({ accountId: "acct-ira", name: "Client IRA" });
    expect(r.qcds[0].amount).toBeGreaterThan(0);
    expect(r.qcds[0].amount * 12).toBeCloseTo(5_000, 2);

    // Outside every total: the IRA's line is its cash, never the gift.
    const y = years[0];
    const ira = r.fromAccounts.accounts.find((a) => a.accountId === "acct-ira")!;
    expect(ira.amount * 12).toBeCloseTo(
      (y.withdrawals.byAccount["acct-ira"] ?? 0) + y.accountLedgers["acct-ira"].rmdAmount,
      4,
    );
    expect(rows[1].qcds).toEqual([]);
    // A QCD that pays the whole RMD leaves the IRA no RMD cash at all — the
    // note must not depend on there being some.
    const wholeRmd = { ...clientData, qcds: [{ ...clientData.qcds![0], amount: 60_000 }] };
    const whole = build(wholeRmd);
    expect(whole.years[0].distributionDetail!.rmdCashByAccount["acct-ira"]).toBeUndefined();
    expect(whole.rows[0].qcds).toHaveLength(1);
    expect(whole.rows[0].qcds[0].amount * 12).toBeGreaterThan(40_000);
    expectCloses(whole.rows);
    // A single client: the survivor-style age label never prints "undefined".
    for (const row of rows) expect(row.ageLabel).not.toContain("undefined");
    expectCloses(rows);
  });

  it("a margin-borrowed draw is labelled on its account line", () => {
    // Shape: src/engine/__tests__/_fixtures/margin.ts `runBorrow` — no income,
    // no tax, $100k of spending covered by borrowing against a brokerage.
    const clientData = buildClientData({
      accounts: [MARGIN_CHECKING, BORROWER],
      incomes: [],
      expenses: [spending(100_000)],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        ...basePlanSettings,
        planEndYear: 2027,
        flatFederalRate: 0,
        flatStateRate: 0,
      },
    });
    const { years, rows } = build(clientData);
    const borrowed = years[0].withdrawals.borrowedByAccount?.[BORROWER.id] ?? 0;
    expect(borrowed).toBeGreaterThan(0);
    const line = rows[0].fromAccounts.accounts.find((a) => a.accountId === BORROWER.id)!;
    expect(line.name).toBe("Schwab Brokerage");
    expect(line.borrowed * 12).toBeCloseTo(borrowed, 4);
    expect(line.borrowed).toBeLessThanOrEqual(line.amount);
    expectCloses(rows);
  });

  it("today's dollars divides by the deflator", () => {
    const clientData = buildClientData({ accounts: withChecking() });
    const years = runProjection(clientData);
    const today = buildMonthlyDistributionRows(years, clientData, "today");
    const nominal = buildMonthlyDistributionRows(years, clientData, "nominal");
    // Default basis is today's dollars, as in the Cash flow view.
    expect(buildMonthlyDistributionRows(years, clientData)[15].need.total).toBe(
      today[15].need.total,
    );
    const n = 15;
    const d = deflator(years[n].year, "today", clientData.planSettings);
    expect(d).toBeLessThan(1);
    expect(nominal[n].fromAccounts.total).toBeGreaterThan(0);
    expect(today[n].need.total).toBeCloseTo(nominal[n].need.total * d, 6);
    expect(today[n].income.total).toBeCloseTo(nominal[n].income.total * d, 6);
    expect(today[n].taxes).toBeCloseTo(nominal[n].taxes * d, 6);
    expect(today[n].fromAccounts.total).toBeCloseTo(nominal[n].fromAccounts.total * d, 6);
    expect(today[n].fromAccounts.accounts[0].amount).toBeCloseTo(
      nominal[n].fromAccounts.accounts[0].amount * d,
      6,
    );
    expect(today[n].fromAccounts.parts.spending).toBeCloseTo(
      nominal[n].fromAccounts.parts.spending * d,
      6,
    );
  });

  it("isRetirementYear ignores a member who has died", () => {
    const yearWithAges = (ages: ProjectionYear["ages"]) => ({ year: 2040, ages }) as ProjectionYear;
    // `baseClient` retires both members at 65.
    expect(isRetirementYear(yearWithAges({ client: 70 }), baseClient)).toBe(true);
    expect(isRetirementYear(yearWithAges({ client: 70, spouse: 60 }), baseClient)).toBe(false);
    expect(isRetirementYear(yearWithAges({ client: 70, spouse: 65 }), baseClient)).toBe(true);
    expect(isRetirementYear(yearWithAges({ client: 60, spouse: 70 }), baseClient)).toBe(false);
    // The engine keeps counting a member's age after their death, so a member
    // past their life expectancy is gone even with an age present.
    const spouseDiedAt59 = { ...baseClient, lifeExpectancy: 90, spouseLifeExpectancy: 59 };
    expect(isRetirementYear(yearWithAges({ client: 70, spouse: 60 }), spouseDiedAt59)).toBe(true);

    // On a real projection: Jane (1972) dies in 2032 before retiring; John
    // (1970) retires at 65 in 2035. Her age still rides on every later year.
    const clientData = buildClientData({
      accounts: withChecking(),
      client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 60 },
    });
    const { years, rows } = build(clientData);
    const at = (year: number) => rows[years.findIndex((y) => y.year === year)];
    expect(years.find((y) => y.year === 2035)!.ages.spouse).toBe(63);
    expect(at(2034).retired).toBe(false);
    expect(at(2035).retired).toBe(true);
    // Her death year still counts her; after it the label holds one age.
    expect(at(2032).ageLabel).toBe("Age 62 / 60");
    expect(at(2035).ageLabel).toBe("Age 65");
  });

  it("the age label lists only living members", () => {
    // John (1970) dies in 2050; Jane (1972) lives on.
    const { years, rows } = build(
      buildClientData({
        accounts: withChecking(),
        client: { ...baseClient, lifeExpectancy: 80, spouseLifeExpectancy: 85 },
      }),
    );
    const at = (year: number) => rows[years.findIndex((y) => y.year === year)];
    // The engine still counts John's age in the survivor years.
    expect(years.find((y) => y.year === 2051)!.ages.client).toBe(81);
    expect(at(2050).ageLabel).toBe("Age 80 / 78");
    for (const r of rows.filter((r) => r.year > 2050)) {
      expect(r.ageLabel).toMatch(/^Age \d+$/);
    }
    expect(at(2051).ageLabel).toBe("Age 79");
  });

  it("rankDistributionAccounts caps at four, largest first", () => {
    const rows = [
      rowWithAccounts([["a", 100], ["b", 50]]),
      rowWithAccounts([["c", 300]]),
      rowWithAccounts([["d", 10], ["e", 20]]),
      rowWithAccounts([["a", 100]]),
      rowWithAccounts([["b", 40], ["e", 5]]),
      rowWithAccounts([["d", 1]]),
    ];
    // Σ: c 300, a 200, b 90, e 25, d 11.
    expect(rankDistributionAccounts(rows)).toEqual([
      { accountId: "c", name: "C" },
      { accountId: "a", name: "A" },
      { accountId: "b", name: "B" },
      { accountId: "e", name: "E" },
    ]);
  });

  it("rankDistributionAccounts sums nominal draws, so the dollar basis can't reorder it", () => {
    // Monthly amounts in today's dollars say "x" draws more; the whole-year
    // future-dollar draws say "y" (its draw comes late, where the deflator bites).
    const x = rowWithAccounts([["x", 100]]);
    const y = rowWithAccounts([["y", 90]]);
    x.fromAccounts.accounts[0].annualNominal = 1_300;
    y.fromAccounts.accounts[0].annualNominal = 2_000;
    expect(rankDistributionAccounts([x, y]).map((a) => a.accountId)).toEqual(["y", "x"]);

    // On a real projection the two bases rank alike.
    const clientData = buildClientData({ accounts: withChecking() });
    const years = runProjection(clientData);
    const rank = (b: DollarBasis) =>
      rankDistributionAccounts(buildMonthlyDistributionRows(years, clientData, b));
    expect(rank("today")).toEqual(rank("nominal"));
  });

  it("hasOtherAccounts is true only when a row draws from an unranked account", () => {
    const rows = [rowWithAccounts([["a", 10], ["b", 5]]), rowWithAccounts([["c", 1]])];
    expect(hasOtherAccounts(rows, [{ accountId: "a" }, { accountId: "b" }])).toBe(true);
    expect(hasOtherAccounts(rows, [{ accountId: "a" }, { accountId: "b" }, { accountId: "c" }])).toBe(false);
  });

  it("an annuity's payout is named Annuity, not Other income", () => {
    const spia: Account = {
      id: "acct-spia",
      name: "Income Annuity",
      category: "annuity",
      subType: "other",
      titlingType: "jtwros",
      value: 150_000,
      basis: 150_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      annuity: {
        productType: "spia",
        incomeMode: "annuitized",
        incomeStartYear: 2026,
        annuitizedPayment: 12_000,
        taxTreatment: "non_qualified",
        costBasis: 150_000,
        annualFeePct: 0,
        rollupRatchets: false,
      },
    };
    const { years, rows } = build(buildClientData({ accounts: withChecking([...sampleAccounts, spia]) }));
    expect(years[0].income.bySource["annuity:acct-spia"]).toBeCloseTo(12_000, 2);
    const annuity = rows[0].income.sources.find((s) => s.label === "Annuity");
    expect(annuity?.amount).toBeCloseTo(1_000, 2);
    expect(rows[0].income.sources.some((s) => s.label === "Other income")).toBe(false);
    expectCloses(rows);
  });

  describe("goals with no set-aside account (R14)", () => {
    const college = (payShortfallOutOfPocket: boolean): Expense => ({
      id: "college",
      type: "education",
      name: "Grandkid college",
      annualAmount: 36_000,
      startYear: 2040,
      endYear: 2040,
      growthRate: 0,
      payShortfallOutOfPocket,
    });

    it("an education goal with no 529 is a need line at what the household paid", () => {
      const { years, rows } = build(withGoal(college(true)));
      const i = years.findIndex((y) => y.year === 2040);
      const y = years[i];
      const r = rows[i];
      const goal = y.goals!.find((g) => g.goalId === "college")!;
      // Liveness: the engine funds it as a goal, from cash flow.
      expect(goal.dedicatedWithdrawal).toBe(0);
      expect(goal.outOfPocketWithdrawal).toBeGreaterThan(0);
      const cost = y.expenses.bySource["college"];
      expect(cost).toBeCloseTo(36_000, 2);

      expect(r.need.goalLines).toEqual([
        { expenseId: "college", name: "Grandkid college", amount: cost / 12 },
      ]);
      expect(r.goals).toEqual([]);
      expect(r.fromAccounts.parts.goalShortfall).toBe(0);
      expect(r.need.other * 12).toBeCloseTo(y.expenses.other - cost, 4);
      expectCloses(rows);
    });

    it("with out-of-pocket off, its unfunded cost is 'short by' in the goals box", () => {
      const { years, rows } = build(withGoal(college(false)));
      const i = years.findIndex((y) => y.year === 2040);
      const y = years[i];
      const r = rows[i];
      const goal = y.goals!.find((g) => g.goalId === "college")!;
      expect(goal.shortfall).toBeCloseTo(36_000, 2);
      expect(y.expenses.bySource["college"]).toBeUndefined();

      expect(r.need.goalLines).toEqual([]);
      expect(r.goals).toEqual([
        {
          goalId: "college",
          name: "Grandkid college",
          setAsideAccountNames: [],
          fromSetAside: 0,
          fromGeneral: 0,
          unfunded: 3_000,
        },
      ]);
      expect(rows[i - 1].goals).toEqual([]);
      expectCloses(rows);
    });
  });

  it("life insurance proceeds are a note, not income, in the year they pay out", () => {
    const policy: Account = {
      id: "pol-term",
      name: "Term Life Policy",
      category: "life_insurance",
      subType: "term",
      titlingType: "jtwros",
      insuredPerson: "client",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      beneficiaries: [
        { id: "b1", tier: "primary", percentage: 100, familyMemberId: LEGACY_FM_SPOUSE, sortOrder: 0 },
      ],
      lifeInsurance: {
        faceValue: 1_000_000,
        costBasis: 0,
        premiumAmount: 0,
        premiumYears: null,
        policyType: "term",
        termIssueYear: 2026,
        termLengthYears: 40,
        endsAtInsuredRetirement: false,
        cashValueGrowthMode: "basic",
        premiumScheduleMode: "off",
        deathBenefitScheduleMode: "off",
        incomeScheduleMode: "off",
        postPayoutGrowthRate: 0,
        premiumPayer: "owner",
        cashValueSchedule: [],
      },
    };
    const clientData = buildClientData({
      accounts: withChecking([...sampleAccounts, policy]),
      client: { ...baseClient, lifeExpectancy: 80, spouseLifeExpectancy: 95 },
    });
    const { years, rows } = build(clientData);
    const i = years.findIndex((y) => (y.income.bySource["life-insurance-proceeds:pol-term"] ?? 0) > 0);
    expect(years[i]?.year).toBe(2050);
    const y = years[i];
    const r = rows[i];

    expect(r.lifeInsuranceProceeds).toBeCloseTo(1_000_000, 2);
    expect(rows.filter((row) => row.lifeInsuranceProceeds > 0).map((row) => row.year)).toEqual([2050]);
    expect(r.income.total * 12).toBeCloseTo(
      y.totalIncome - y.distributionDetail!.rmdInTotalIncome - 1_000_000,
      4,
    );
    // Money really was drawn that year, and the card says what it paid for.
    expect(r.fromAccounts.total).toBeGreaterThan(0);
    expect(r.fromAccounts.parts.spending).toBeGreaterThan(0);
    expectCloses(rows);

    // Today's dollars: the lump sum is deflated like every other figure.
    const today = buildMonthlyDistributionRows(years, clientData, "today")[i];
    expect(today.lifeInsuranceProceeds).toBeCloseTo(
      1_000_000 * deflator(2050, "today", clientData.planSettings),
      2,
    );
  });

  describe("survivor years: RMDs follow the engine's routing after a death (C1)", () => {
    /** Every RMD the engine sent to household checking is (part of) a line
     *  under its own account, named — never a raw id. */
    function expectRmdsOnTheirAccounts(years: ProjectionYear[], rows: DistributionRow[]) {
      years.forEach((y, i) => {
        const r = rows[i];
        for (const [id, cash] of Object.entries(y.distributionDetail!.rmdCashByAccount)) {
          if (cash / 12 < MIN_LINE_PER_MONTH) continue;
          const line = r.fromAccounts.accounts.find((a) => a.accountId === id);
          expect(line, `${y.year} ${id}`).toBeDefined();
          expect(line!.amount * 12, `${y.year} ${id}`).toBeGreaterThanOrEqual(cash - 0.01);
        }
        for (const a of r.fromAccounts.accounts) {
          expect(a.name, `${y.year} ${a.accountId}`).not.toMatch(/^(death-acct|acct)-|Unnamed/);
        }
      });
    }

    it("an IRA split between spouse and child: each share's required withdrawal is its own line", () => {
      const { years, rows } = build(iraSplitAtFirstDeath());
      const shares = (years.find((y) => y.year === FIRST_DEATH_YEAR)!.deathTransfers ?? [])
        .filter((t) => t.sourceAccountId === "acct-401k")
        .map((t) => t.resultingAccountId!);
      expect(shares).toHaveLength(2);

      expectCloses(rows);
      expectRmdsOnTheirAccounts(years, rows);
      const survivor = rows.filter((r) => r.year > FIRST_DEATH_YEAR);
      expect(survivor.length).toBe(10);
      // The child's share pays from the first survivor year, Jane's from her 75th.
      const shareLines = survivor.flatMap((r) =>
        r.fromAccounts.accounts.filter((a) => shares.includes(a.accountId)),
      );
      expect(new Set(shareLines.map((a) => a.accountId))).toEqual(new Set(shares));
      for (const a of shareLines) expect(a.name).toMatch(/^John IRA — to /);
      // The inherited Roth's tax-free payout is a line too, never income.
      for (const r of survivor) {
        expect(r.fromAccounts.accounts.some((a) => a.accountId === JANE_INHERITED_ROTH.id), `${r.year}`)
          .toBe(true);
      }
    });

    it("an IRA left to a trust: its RMD is the trust's, so no household line and no residue", () => {
      const { years, rows } = build(iraToTrustAtFirstDeath());
      // Liveness: the trust's IRA really does take RMDs in the survivor years.
      expect(years.some((y) => y.year > FIRST_DEATH_YEAR && y.accountLedgers["acct-401k"]?.rmdAmount > 0))
        .toBe(true);

      expectCloses(rows);
      expectRmdsOnTheirAccounts(years, rows);
      for (const r of rows.filter((row) => row.year > FIRST_DEATH_YEAR)) {
        expect(r.fromAccounts.accounts.some((a) => a.accountId === "acct-401k"), `${r.year}`).toBe(false);
      }
    });
  });
});

describe("buildDistributionMonths", () => {
  /** Retired from 2037. John's Social Security pays all year from then; Jane's
   *  starts at her FRA, June 2039 (born 1972-06-15, claims at 67). */
  const janeSs: Income = {
    id: "inc-ss-jane",
    type: "social_security",
    name: "Jane SS",
    annualAmount: 24_000,
    startYear: 2026,
    endYear: 2067,
    growthRate: 0.02,
    owner: "spouse",
    claimingAge: 67,
  };

  function monthsFor(clientData: ClientData, year: number, basis: DollarBasis = "nominal") {
    const { years, rows } = build(clientData, basis);
    const i = years.findIndex((y) => y.year === year);
    const row = rows[i];
    return { y: years[i], row, months: buildDistributionMonths(years[i], row, clientData, basis) };
  }

  /** Every month-series adds back to the year's row. */
  function expectAddsUp(row: DistributionRow, months: ReturnType<typeof buildDistributionMonths>) {
    expect(months).toHaveLength(12);
    expect(sum(months.map((m) => m.need))).toBeCloseTo(row.need.total * 12, 4);
    expect(sum(months.map((m) => m.income))).toBeCloseTo(row.income.total * 12, 4);
    for (const a of row.fromAccounts.accounts) {
      const months12 = months.map((m) => m.accounts.find((x) => x.accountId === a.accountId)!.amount);
      expect(sum(months12), a.name).toBeCloseTo(a.amount * 12, 4);
      for (const v of months12) expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(sum(months.map((m) => m.cash))).toBeCloseTo(0, 4);
  }

  const drawn = (m: { accounts: { amount: number }[]; cash: number }) =>
    sum(m.accounts.map((a) => a.amount)) + m.cash;

  it("draws more before Social Security starts and less after, and the year still adds up", () => {
    const base = buildClientData({ accounts: withChecking() });
    const clientData = { ...base, incomes: [...base.incomes, janeSs] };
    const { y, row, months } = monthsFor(clientData, 2039);
    const jane = y.income.bySource["inc-ss-jane"];
    expect(jane).toBeGreaterThan(0);
    expect(row.fromAccounts.total).toBeGreaterThan(0);

    expectAddsUp(row, months);
    // Seven June-December payments: each month from June gets one.
    const janeMonthly = jane / 7;
    expect(months[5].income - months[4].income).toBeCloseTo(janeMonthly, 4);
    // The accounts make up for it, month for month.
    expect(drawn(months[4]) - drawn(months[5])).toBeCloseTo(janeMonthly, 4);
    for (const m of months) expect(m.cash).toBe(0);
    // Need and taxes don't move.
    expect(months[4].need).toBeCloseTo(months[5].need, 6);
    expect(months[0].taxes).toBe(row.taxes);
  });

  it("puts a once-a-year bill in its month, on the need line and the draw", () => {
    const roof: Expense = {
      id: "exp-roof",
      type: "other",
      name: "Roof",
      annualAmount: 30_000,
      startYear: 2040,
      endYear: 2040,
      growthRate: 0,
      paymentMonth: 8,
    };
    const base = buildClientData({ accounts: withChecking() });
    const clientData = { ...base, expenses: [...base.expenses, roof] };
    const { row, months } = monthsFor(clientData, 2040);

    expectAddsUp(row, months);
    expect(months[7].need - months[6].need).toBeCloseTo(30_000, 4);
    expect(drawn(months[7]) - drawn(months[6])).toBeCloseTo(30_000, 4);
  });

  it("holds a month's spare income as cash for the months that are short", () => {
    const gift: Income = {
      id: "inc-gift",
      type: "other",
      name: "Inheritance",
      annualAmount: 40_000,
      startYear: 2040,
      endYear: 2040,
      growthRate: 0,
      owner: "client",
      paymentMonth: 3,
    };
    const base = buildClientData({ accounts: withChecking() });
    const clientData = { ...base, incomes: [...base.incomes, gift] };
    const { row, months } = monthsFor(clientData, 2040);

    expectAddsUp(row, months);
    // March has more than it needs: nothing from the accounts, the rest held.
    expect(months[2].cash).toBeLessThan(0);
    expect(sum(months[2].accounts.map((a) => a.amount))).toBe(0);
    // The other months spend it.
    expect(months[0].cash).toBeGreaterThan(0);
    // Every month closes: income plus what was drawn (net of cash held) pays
    // the month's need and taxes — the year has nothing else to pay for.
    expect(row.fromAccounts.total).toBeCloseTo(row.fromAccounts.parts.spending + row.fromAccounts.parts.taxes, 6);
    for (const m of months) {
      expect(m.income + drawn(m), m.label).toBeCloseTo(m.need + m.taxes, 4);
    }
  });

  it("a working year that saves draws nothing in any month, bonus month or not", () => {
    const bonus: Income = {
      id: "inc-bonus",
      type: "other",
      name: "Bonus",
      annualAmount: 30_000,
      startYear: 2026,
      endYear: 2026,
      growthRate: 0,
      owner: "client",
      paymentMonth: 3,
    };
    const base = buildClientData({ accounts: withChecking() });
    const clientData = { ...base, incomes: [...base.incomes, bonus] };
    const { row, months } = monthsFor(clientData, 2026);
    expect(row.fromAccounts.total).toBe(0);
    expect(row.fromAccounts.parts.keptOrReinvested).toBe(0);

    expectAddsUp(row, months);
    for (const m of months) {
      expect(Math.abs(drawn(m)), m.label).toBeLessThan(1);
      expect(Math.abs(m.cash), m.label).toBeLessThan(1);
    }
  });

  it("follows the dollar basis", () => {
    const base = buildClientData({ accounts: withChecking() });
    const clientData = { ...base, incomes: [...base.incomes, janeSs] };
    const today = monthsFor(clientData, 2039, "today");
    const nominal = monthsFor(clientData, 2039, "nominal");
    const k = deflator(2039, "today", clientData.planSettings);
    expectAddsUp(today.row, today.months);
    for (let i = 0; i < 12; i++) {
      expect(today.months[i].income).toBeCloseTo(nominal.months[i].income * k, 4);
      expect(drawn(today.months[i])).toBeCloseTo(drawn(nominal.months[i]) * k, 4);
    }
  });
});
