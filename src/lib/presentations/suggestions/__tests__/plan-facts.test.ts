import { describe, it, expect } from "vitest";
import { buildClientData, baseClient } from "@/engine/__tests__/fixtures";
import { runProjectionWithEvents } from "@/engine/projection";
import type { Liability } from "@/engine/types";
import { buildPlanFacts, type PlanFactExtras } from "../plan-facts";

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
