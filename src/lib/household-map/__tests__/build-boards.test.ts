// src/lib/household-map/__tests__/build-boards.test.ts
import { describe, it, expect } from "vitest";
import { buildMapBoards } from "../build-boards";
import type { MapBoardsInput } from "../build-boards";
import type {
  Account,
  ClientData,
  ClientInfo,
  Expense,
  Liability,
  PlanSettings,
} from "@/engine/types";

// Fully typed fixtures, no casts — the same idiom as `map-items.test.ts`. A cast
// to `MapBoardsInput` would hide a field-shape drift between this fixture and
// the engine `ClientData` the real caller passes, which is the one thing this
// module's tests exist to catch.

const clientInfo: ClientInfo = {
  firstName: "Cooper",
  lastName: "Reid",
  dateOfBirth: "1976-04-01",
  retirementAge: 65,
  planEndAge: 95,
  lifeExpectancy: 90,
  filingStatus: "single",
};

const planSettings: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2066,
};

const account = (over: Partial<Account> = {}): Account => ({
  id: "a1",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 500_000,
  basis: 300_000,
  growthRate: 0.06,
  rmdEnabled: false,
  titlingType: "jtwros",
  owners: [],
  ...over,
});

const liability = (over: Partial<Liability> = {}): Liability => ({
  id: "l1",
  name: "Mortgage",
  balance: 200_000,
  interestRate: 0.055,
  monthlyPayment: 2_400,
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  extraPayments: [],
  owners: [],
  ...over,
});

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: "e1",
  type: "other",
  name: "New roof",
  annualAmount: 40_000,
  startYear: 2030,
  endYear: 2030,
  growthRate: 0,
  isGoal: true,
  source: "manual",
  ...over,
});

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: clientInfo,
    accounts: [account()],
    incomes: [],
    expenses: [expense()],
    liabilities: [liability()],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    giftEvents: [],
    ...over,
  };
}

function input(overrides: Partial<MapBoardsInput> = {}): MapBoardsInput {
  return {
    effectiveTree: tree(),
    identity: { dateOfBirth: "1976-04-01", spouseDob: null, lifeExpectancy: 90 },
    familyMemberRows: [
      { id: "fm-1", role: "client", firstName: "Cooper", dateOfBirth: "1976-04-01" },
    ],
    entityRows: [],
    today: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

describe("buildMapBoards", () => {
  it("nets assets against debts", () => {
    expect(buildMapBoards(input()).netWorth).toBe(300_000);
  });

  it("emits one card per account, liability and expense", () => {
    const { items } = buildMapBoards(input());
    expect(items.map((i) => i.id).sort()).toEqual(["a1", "e1", "l1"]);
  });

  it("signs outflows negative so band subtotals net out", () => {
    const { items } = buildMapBoards(input());
    expect(items.find((i) => i.id === "e1")!.value).toBe(-40_000);
    expect(items.find((i) => i.id === "l1")!.value).toBe(-200_000);
  });

  it("promotes an isGoal expense onto the goals board", () => {
    const { goals } = buildMapBoards(input());
    const roof = goals.find((g) => g.expenseId === "e1");
    expect(roof).toBeDefined();
    expect(roof!.year).toBe(2030);
  });

  it("emits a life-expectancy milestone at birthYear + lifeExpectancy", () => {
    const { goals } = buildMapBoards(input());
    const le = goals.find((g) => g.lifeExpectancy?.owner === "client");
    expect(le!.year).toBe(1976 + 90);
  });

  it("derives ages from `today`, never the wall clock", () => {
    const { people } = buildMapBoards(input({ today: new Date("2040-06-01T00:00:00Z") }));
    expect(people.client.age).toBe(64);
  });

  it("returns no spouse node when the tree carries no spouse name", () => {
    expect(buildMapBoards(input()).people.spouse).toBeNull();
  });
});
