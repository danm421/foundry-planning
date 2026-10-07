import { describe, it, expect } from "vitest";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";
import { runProjectionWithEvents, type ProjectionResult } from "@/engine/projection";
import type { Liability, ProjectionYear } from "@/engine/types";
import { buildPlanFacts, projectedFacts, type PlanFactExtras } from "../plan-facts";

const EXTRAS: PlanFactExtras = {
  planRef: "base",
  scenarios: [],
  proposals: [],
  hasHoldings: false,
  observationCount: 0,
  storyChapterCount: 0,
};
const TODAY = new Date(2026, 5, 1);

function liability(over: Partial<Liability>): Liability {
  return {
    id: "l",
    name: "Loan",
    balance: 10_000,
    interestRate: 0.05,
    monthlyPayment: 200,
    startYear: 2024,
    startMonth: 1,
    termMonths: 120,
    extraPayments: [],
    owners: [],
    ...over,
  } as Liability;
}

describe("buildPlanFacts", () => {
  it("reads ages and the years to the next retirement from the principals", () => {
    const f = buildPlanFacts({ tree: buildClientData(), projection: null, extras: EXTRAS, today: TODAY });
    // Client born 1970-01-01, spouse 1972-06-15, both retiring at 65.
    expect(f.clientAge).toBe(56);
    expect(f.youngestAge).toBe(53);
    expect(f.yearsToRetirement).toBe(9);
    expect(f.allRetired).toBe(false);
    expect(f.married).toBe(true);
  });

  it("calls a household retired only once every principal is past retirement age", () => {
    const tree = buildClientData({
      client: { ...baseClient, dateOfBirth: "1950-01-01", spouseDob: "1955-01-01" },
    });
    const f = buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY });
    expect(f.allRetired).toBe(true);
    expect(f.yearsToRetirement).toBe(0);
  });

  it("splits pre-tax from Roth, counting a 401(k)'s Roth slice as Roth", () => {
    const tree = buildClientData();
    tree.accounts = tree.accounts.map((a) => (a.id === "acct-401k" ? { ...a, rothValue: 100_000 } : a));
    const f = buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY });
    expect(f.preTax).toBe(400_000);
    expect(f.roth).toBe(300_000);
  });

  it("picks the costliest non-mortgage debt and ignores credit cards", () => {
    const tree = buildClientData({
      liabilities: [
        liability({ id: "m", name: "Mortgage", balance: 300_000, interestRate: 0.07, liabilityType: "mortgage" }),
        liability({ id: "cc", name: "Card", balance: 5_000, interestRate: 0.24, liabilityType: "credit_card" }),
        liability({ id: "s", name: "Student loan", balance: 40_000, interestRate: 0.068, liabilityType: "student" }),
        liability({ id: "a", name: "Car", balance: 20_000, interestRate: 0.049, liabilityType: "auto" }),
      ],
    });
    const f = buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY });
    expect(f.topDebt).toEqual({ id: "s", name: "Student loan", balance: 40_000, interestRate: 0.068 });
  });

  it("treats an untyped loan named as a mortgage as one", () => {
    const tree = buildClientData({
      liabilities: [liability({ id: "m", name: "First Mortgage", balance: 100_000, interestRate: 0.065, liabilityType: null })],
    });
    const f = buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY });
    expect(f.topDebt).toBeNull();
  });

  it("dates Medicare from the older principal's 65th birthday", () => {
    // Client is 56 in 2026.
    expect(buildPlanFacts({ tree: buildClientData(), projection: null, extras: EXTRAS, today: TODAY }).medicareYear).toBe(2035);
  });

  it("counts a gift series once, however many years it fans out to", () => {
    const tree = buildClientData({
      giftEvents: [2027, 2028, 2029].map((year) => ({
        kind: "cash" as const,
        year,
        amount: 19_000,
        grantor: "client" as const,
        useCrummeyPowers: false,
        seriesId: "series-1",
      })),
    });
    expect(buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY }).giftCount).toBe(1);
  });

  it("totals the conversions the projection actually ran, and their years", () => {
    const tree = buildClientData({
      rothConversions: [
        {
          id: "rc",
          name: "Ladder",
          destinationAccountId: "acct-roth",
          sourceAccountIds: ["acct-401k"],
          conversionType: "fixed_amount",
          fixedAmount: 50_000,
          startYear: 2027,
          endYear: 2028,
          indexingRate: 0,
        },
      ],
    });
    const f = buildPlanFacts({ tree, projection: runProjectionWithEvents(tree), extras: EXTRAS, today: TODAY });
    expect(f.projected!.rothConverted).toBe(100_000);
    expect(f.projected!.rothFirstYear).toBe(2027);
    expect(f.projected!.rothLastYear).toBe(2028);
  });
});

// 2025 MFJ federal tiers — enough to place a year in, or at the edge of, a bracket.
const TIERS = [
  { from: 0, to: 23_850, rate: 0.1 },
  { from: 23_850, to: 96_950, rate: 0.12 },
  { from: 96_950, to: 206_700, rate: 0.22 },
  { from: 206_700, to: 394_600, rate: 0.24 },
  { from: 394_600, to: null, rate: 0.32 },
];

/** A projection year carrying only what `projectedFacts` reads. */
function year(
  y: number,
  o: {
    base?: number; converted?: number; ss?: number; liquid?: number; amt?: number;
    aboveLine?: number; itemized?: number; standard?: number; capGains?: number;
  } = {},
): ProjectionYear {
  const itemized = o.itemized ?? 0;
  const standard = o.standard ?? 30_000;
  return {
    year: y,
    ages: { client: 60 },
    income: { socialSecurity: o.ss ?? 0 },
    rothConversions: o.converted ? [{ gross: o.converted, taxable: o.converted }] : [],
    withdrawals: { total: 0 },
    expenses: { total: 50_000, liabilities: 10_000 },
    savings: { total: 5_000, employerTotal: 0 },
    portfolioAssets: { liquidTotal: o.liquid ?? 500_000 },
    taxDetail: { capitalGains: o.capGains ?? 0 },
    deductionBreakdown: {
      aboveLine: { total: o.aboveLine ?? 0 },
      belowLine: { itemizedTotal: itemized, standardDeduction: standard, taxDeductions: Math.max(itemized, standard) },
    },
    taxResult: {
      flow: {
        incomeTaxBase: o.base ?? 100_000, totalFederalTax: 10_000, stateTax: 2_000, capitalGainsTax: 0,
        fica: 0, totalTax: 12_000, amtAdditional: o.amt ?? 0, niit: 0,
      },
      income: { grossTotalIncome: 120_000 },
      diag: { incomeBracketsForFiling: TIERS, marginalBracketTier: TIERS[2] },
    },
  } as unknown as ProjectionYear;
}

const projection = (years: ProjectionYear[]) =>
  ({ years, giftLedger: [], firstDeathEvent: undefined, secondDeathEvent: undefined }) as unknown as ProjectionResult;

describe("projectedFacts — tax and flows", () => {
  it("counts the years that end within $10k of the next federal bracket, and the conversion years among them", () => {
    const p = projectedFacts(
      projection([
        year(2026, { base: 150_000 }),                               // 22%, $56.7k of room — not an edge
        year(2027, { base: 200_000, converted: 60_000 }),            // 22%, $6.7k left — edge
        year(2028, { base: 206_700, converted: 80_000 }),            // fills 22% exactly — edge
        year(2029, { base: 390_000, converted: 150_000, amt: 5_000 }), // AMT year — never an edge
      ]),
      2026,
    );
    expect(p.bracketEdgeYears).toBe(2);
    expect(p.conversionYears).toBe(3);
    expect(p.conversionEdgeYears).toBe(2);
    expect(p.conversionTopRate).toBe(0.24);
    expect(p.topFederalRate).toBe(0.24);
    expect(p.amtOrNiitYears).toBe(1);
  });

  it("reads the ending portfolio, the first Social Security year and the lifetime flows", () => {
    const p = projectedFacts(
      projection([year(2026), year(2027, { ss: 30_000 }), year(2028, { ss: 31_000, liquid: 420_000 })]),
      2026,
    );
    expect(p.endingPortfolio).toBe(420_000);
    expect(p.ssFirstYear).toBe(2027);
    expect(p.lifetimeExpenses).toBe(150_000);
    expect(p.lifetimeDebtPayments).toBe(30_000);
    expect(p.lifetimeSavings).toBe(15_000);
    expect(p.lifetimeTax).toEqual({ total: 36_000, federal: 30_000, state: 6_000, capitalGains: 0 });
  });

  it("totals the deductions taken and counts the years the plan itemizes", () => {
    const p = projectedFacts(
      projection([
        year(2026, { aboveLine: 8_000, itemized: 35_000 }),
        year(2027, { aboveLine: 8_000, itemized: 20_000 }),
      ]),
      2026,
    );
    expect(p.itemizingYears).toBe(1);
    expect(p.aboveLineTotal).toBe(16_000);
    expect(p.belowLineTaken).toBe(65_000);
  });

  it("keeps the largest one-year capital gain of $25k or more", () => {
    const p = projectedFacts(
      projection([year(2026, { capGains: 30_000 }), year(2027, { capGains: 140_000 }), year(2028, { capGains: 10_000 })]),
      2026,
    );
    expect(p.bigGain).toEqual({ year: 2027, gain: 140_000 });
  });

  it("names who dies first, from the engine's own death event", () => {
    const tree = buildClientData();
    const run = runProjectionWithEvents(tree);
    expect(projectedFacts(run, 2026).firstToDie).toBe(run.firstDeathEvent?.deceased ?? null);
  });
});

describe("buildPlanFacts — setup facts", () => {
  it("knows whether the plan figures tax by bracket", () => {
    const bracket = buildClientData({ planSettings: { ...basePlanSettings, taxEngineMode: "bracket" } });
    const flat = buildClientData({ planSettings: { ...basePlanSettings, taxEngineMode: "flat" } });
    expect(buildPlanFacts({ tree: bracket, projection: null, extras: EXTRAS, today: TODAY }).bracketMode).toBe(true);
    expect(buildPlanFacts({ tree: flat, projection: null, extras: EXTRAS, today: TODAY }).bracketMode).toBe(false);
  });

  it("counts education and other goal expenses as goals", () => {
    const base = buildClientData();
    const tree = buildClientData({
      expenses: [
        ...base.expenses,
        { ...base.expenses[0], id: "edu", type: "education" },
        { ...base.expenses[0], id: "boat", type: "other", isGoal: true },
      ],
    });
    const before = buildPlanFacts({ tree: base, projection: null, extras: EXTRAS, today: TODAY }).goalCount;
    expect(buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY }).goalCount).toBe(before + 2);
  });

  it("names the stress tests the plan runs under, as the Assumptions page does", () => {
    const tree = buildClientData({
      planSettings: {
        ...basePlanSettings,
        taxEngineMode: "flat",
        marketShock: { year: 2030, drawdownPct: 0.3 },
        taxRateStress: { points: 0.03, startYear: 2030 } as never, // shown only on bracket tax
      },
    });
    expect(buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY }).stressItems).toEqual(["a market drop"]);
  });

  it("never offers a loan the Debt-or-Invest page can't reach", () => {
    const tree = buildClientData({
      liabilities: [
        liability({ id: "no-term", name: "Family loan", interestRate: 0.09, termMonths: null as never }),
        liability({ id: "car", name: "Car loan", interestRate: 0.07 }),
      ],
    });
    expect(buildPlanFacts({ tree, projection: null, extras: EXTRAS, today: TODAY }).topDebt?.id).toBe("car");
  });
});

describe("buildPlanFacts — a chosen scenario", () => {
  const baseTree = buildClientData({ planSettings: { ...basePlanSettings, taxEngineMode: "bracket" } });
  const planTree = buildClientData({
    planSettings: { ...basePlanSettings, taxEngineMode: "bracket" },
    rothConversions: [
      {
        id: "rc", name: "Ladder", destinationAccountId: "acct-roth", sourceAccountIds: ["acct-401k"],
        conversionType: "fixed_amount", fixedAmount: 50_000, startYear: 2027, endYear: 2028, indexingRate: 0,
      },
    ],
  });

  it("records what the scenario changes and how it moved against Base Case", () => {
    const f = buildPlanFacts({
      tree: planTree,
      projection: runProjectionWithEvents(planTree),
      extras: { ...EXTRAS, planRef: "s1" },
      today: TODAY,
      scenario: {
        id: "s1",
        name: "Roth ladder",
        rows: [{ opType: "add", targetKind: "roth_conversion", targetId: "rc", payload: {}, toggleGroupId: null }],
        baseTree,
        baseProjection: runProjectionWithEvents(baseTree),
      },
    });
    expect(f.scenario?.name).toBe("Roth ladder");
    expect(f.scenario?.changes.roth?.count).toBe(1);
    expect(f.scenario?.moved.convertsMore).toBe(true);
    expect(f.scenario?.base?.rothConverted).toBe(0);
  });

  it("has no scenario facts for a scenario whose changes are all switched off", () => {
    const f = buildPlanFacts({
      tree: baseTree, projection: null, extras: { ...EXTRAS, planRef: "s1" }, today: TODAY,
      scenario: { id: "s1", name: "Empty", rows: [], baseTree, baseProjection: null },
    });
    expect(f.scenario).toBeNull();
  });
});
