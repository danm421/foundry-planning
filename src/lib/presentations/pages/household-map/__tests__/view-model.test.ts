// src/lib/presentations/pages/household-map/__tests__/view-model.test.ts
//
// These three view-models are thin — the real work is `buildMapBoards`, which
// has its own suite. What is NOT covered there, and what these tests exist for,
// is the two things this layer decides on its own:
//
//   1. The wiring off `BuildDataContext`. The presentation pipeline hands these
//      pages an effective tree and nothing else, so `identity`, `familyMemberRows`
//      and `entityRows` are all re-derived here. A wrong field lands silently:
//      a missing `familyMembers` doesn't crash, it just trays every account, and
//      a missing `entities` prints "Entity-owned" instead of the trust's name.
//   2. The arithmetic printed at the bottom of each page — column subtotals,
//      band subtotals, and the two grand totals. Those are the numbers an
//      advisor hands a client.

import { describe, it, expect } from "vitest";
import {
  buildMapCashFlowData,
  buildMapGoalsData,
  buildMapNetWorthData,
  type HouseholdMapBuildInput,
} from "../view-model";
import type {
  Account,
  ClientData,
  ClientInfo,
  Expense,
  Income,
  Liability,
  PlanSettings,
  SavingsRule,
} from "@/engine/types";

const CLIENT_DOB = "1976-04-01";
const SPOUSE_DOB = "1979-09-15";
const TODAY = new Date("2026-06-01T00:00:00Z");

const FM_CLIENT = "fm-1";
const FM_SPOUSE = "fm-2";
const ENTITY_ID = "ent-1";

const clientInfo = (over: Partial<ClientInfo> = {}): ClientInfo => ({
  firstName: "Cooper",
  lastName: "Reid",
  dateOfBirth: CLIENT_DOB,
  retirementAge: 65,
  planEndAge: 95,
  lifeExpectancy: 90,
  filingStatus: "married_joint",
  spouseName: "Riley",
  spouseDob: SPOUSE_DOB,
  spouseRetirementAge: 60,
  spouseLifeExpectancy: 88,
  ...over,
});

const planSettings: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2071,
};

const ownClient = [{ kind: "family_member" as const, familyMemberId: FM_CLIENT, percent: 1 }];
const ownSpouse = [{ kind: "family_member" as const, familyMemberId: FM_SPOUSE, percent: 1 }];
const ownEntity = [{ kind: "entity" as const, entityId: ENTITY_ID, percent: 1 }];

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
  owners: ownClient,
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
  owners: ownClient,
  ...over,
});

const income = (over: Partial<Income> = {}): Income => ({
  id: "i1",
  type: "salary",
  name: "Salary",
  annualAmount: 180_000,
  startYear: 2026,
  endYear: 2041,
  growthRate: 0.03,
  // A FLOW's column comes from `owner` (and `ownerEntityId` for the tray), not
  // from `owners[]` — see `flowAssignment`. Balance rows are the ones that read
  // the ownership array.
  owner: "client",
  ...over,
});

const savingsRule = (over: Partial<SavingsRule> = {}): SavingsRule => ({
  id: "s1",
  accountId: "a1",
  annualAmount: 23_000,
  isDeductible: true,
  startYear: 2026,
  endYear: 2041,
  ...over,
});

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: "e1",
  type: "other",
  name: "Groceries",
  annualAmount: 40_000,
  startYear: 2026,
  endYear: 2071,
  growthRate: 0,
  source: "manual",
  ...over,
});

function tree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: clientInfo(),
    accounts: [account()],
    incomes: [income()],
    expenses: [expense()],
    liabilities: [liability()],
    savingsRules: [savingsRule()],
    withdrawalStrategy: [],
    planSettings,
    giftEvents: [],
    familyMembers: [
      {
        id: FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Cooper",
        lastName: "Reid",
        dateOfBirth: CLIENT_DOB,
      },
      {
        id: FM_SPOUSE,
        role: "spouse",
        relationship: "other",
        firstName: "Riley",
        lastName: "Reid",
        dateOfBirth: SPOUSE_DOB,
      },
    ],
    entities: [{ id: ENTITY_ID, name: "Reid Family Trust", includeInPortfolio: false, isGrantor: true }],
    ...over,
  };
}

function input(over: Partial<HouseholdMapBuildInput> = {}): HouseholdMapBuildInput {
  return { clientData: tree(), scenarioLabel: "Base Case", today: TODAY, ...over };
}

describe("Household Map — Net Worth page", () => {
  it("puts each balance row in its owner's column and subtotals it", () => {
    const data = buildMapNetWorthData(
      input({
        clientData: tree({
          accounts: [account(), account({ id: "a2", name: "Riley IRA", value: 250_000, owners: ownSpouse })],
        }),
      }),
    );

    const byKey = Object.fromEntries(data.columns.map((c) => [c.key, c]));
    expect(byKey.client.label).toBe("Cooper");
    expect(byKey.client.cards.map((c) => c.name)).toEqual(["Brokerage", "Mortgage"]);
    // 500,000 asset − 200,000 debt. Proves the column sums the SIGNED value.
    expect(byKey.client.subtotalLabel).toBe("$300,000");
    expect(byKey.spouse.label).toBe("Riley");
    expect(byKey.spouse.subtotalLabel).toBe("$250,000");
  });

  it("trays an entity-owned account under the trust's real name", () => {
    const data = buildMapNetWorthData(
      input({
        clientData: tree({
          accounts: [account({ id: "a3", name: "Trust brokerage", value: 100_000, owners: ownEntity })],
        }),
      }),
    );

    // Names come from `clientData.entities`. Without that wiring the card still
    // trays, but labelled the generic "Entity-owned" — a silent downgrade.
    expect(data.tray?.cards.map((c) => c.trayOwnerLabel)).toEqual(["Reid Family Trust"]);
  });

  it("keeps cash-flow rows off the board and totals assets minus debts", () => {
    const data = buildMapNetWorthData(input());
    const names = [...data.columns.flatMap((c) => c.cards), ...(data.tray?.cards ?? [])].map(
      (c) => c.name,
    );
    expect(names).not.toContain("Salary");
    expect(names).not.toContain("Groceries");
    expect(data.totalValueLabel).toBe("$300,000");
  });

  it("labels the middle column 'Joint' and drops the spouse column when solo", () => {
    const data = buildMapNetWorthData(
      input({ clientData: tree({ client: clientInfo({ spouseName: undefined, spouseDob: undefined }) }) }),
    );
    expect(data.columns.map((c) => c.key)).toEqual(["client", "joint"]);
    expect(data.columns[1].label).toBe("Joint");
  });
});

describe("Household Map — Cash Flow page", () => {
  it("signs each band and nets the three", () => {
    const data = buildMapCashFlowData(input());
    const byKey = Object.fromEntries(data.bands.map((b) => [b.key, b]));

    expect(byKey.income.subtotalLabel).toBe("$180,000");
    // Savings and expenses are OUTFLOWS — a positive subtotal here would mean
    // the signed-`value` contract had been re-derived somewhere.
    expect(byKey.savings.subtotalLabel).toBe("($23,000)");
    expect(byKey.expense.subtotalLabel).toBe("($40,000)");
    expect(data.netValueLabel).toBe("$117,000");
    // Every savings rule here is a flat dollar amount, so nothing is withheld.
    expect(data.unresolvedNote).toBeNull();
  });

  // A rule the projection alone can price — "IRS max", "10% of pay", a custom
  // schedule — carries a literal 0 (`resolveSavings`). Summing it prints
  // "Savings $0" over a card that says "IRS max", and nets a leftover figure
  // that is too high by the whole contribution. The board can get away with it
  // because the rule is on the card beside the total; a printed page handed to
  // a client cannot.
  it.each([
    ["contributeMax", { contributeMax: true }],
    ["percent-of-pay", { annualPercent: 0.1 }],
    ["custom schedule", { scheduleOverrides: { 2027: 5_000 } }],
  ])("withholds the savings and net totals when a rule is %s", (_label, over) => {
    const data = buildMapCashFlowData(
      input({ clientData: tree({ savingsRules: [savingsRule(over as Partial<SavingsRule>)] }) }),
    );
    const byKey = Object.fromEntries(data.bands.map((b) => [b.key, b]));

    expect(byKey.savings.subtotalLabel).toBeNull();
    expect(data.netValueLabel).toBeNull();
    expect(data.unresolvedNote).toContain("resolve in the projection");
    // Only the affected band goes quiet — income and expenses still total.
    expect(byKey.income.subtotalLabel).toBe("$180,000");
    expect(byKey.expense.subtotalLabel).toBe("($40,000)");
  });

  it("keeps an entity-owned flow in its band's tray rather than dropping it", () => {
    const data = buildMapCashFlowData(
      input({
        clientData: tree({
          incomes: [
            income(),
            income({ id: "i2", name: "Trust rent", annualAmount: 20_000, ownerEntityId: ENTITY_ID }),
          ],
        }),
      }),
    );
    const incomeBand = data.bands.find((b) => b.key === "income")!;

    expect(incomeBand.tray?.cards.map((c) => c.name)).toEqual(["Trust rent"]);
    // The tray card must still count. Dropping it from the subtotal is the
    // failure mode the board's own tray row was added to fix.
    expect(incomeBand.subtotalLabel).toBe("$200,000");
  });

  it("carries each row's projection window for the timing cell", () => {
    const data = buildMapCashFlowData(input());
    const salary = data.bands[0].columns.flatMap((c) => c.cards).find((c) => c.name === "Salary");
    expect(salary?.timing).toMatchObject({ startYear: 2026, endYear: 2041 });
  });
});

describe("Household Map — Goals page", () => {
  it("places each milestone on its year with both ages", () => {
    const data = buildMapGoalsData(input());
    const retirement = data.rows.find((r) => r.title.includes("Cooper") && r.kindLabel === "Retirement");

    // Cooper retires at 65 against a 1976 DOB.
    expect(retirement?.year).toBe(2041);
    expect(retirement?.agesLabel).toBe("65 / 62");
    expect(retirement?.side).toBe("client");
  });

  it("falls back to the engine's assumed life expectancy when none is stored", () => {
    const data = buildMapGoalsData(
      input({
        clientData: tree({
          client: clientInfo({ lifeExpectancy: undefined, spouseName: undefined, spouseDob: undefined }),
        }),
      }),
    );
    const le = data.rows.find((r) => r.kindLabel === "Life expectancy");
    // 1976 + 95. The projection really does run to that year, so the card has to
    // show it rather than going missing.
    expect(le?.year).toBe(2071);
  });

  it("notes an empty board only when no goal is expense-backed", () => {
    expect(buildMapGoalsData(input()).emptyNote).not.toBeNull();

    const withGoal = buildMapGoalsData(
      input({
        clientData: tree({
          expenses: [expense({ id: "e2", name: "New roof", startYear: 2030, endYear: 2030, isGoal: true })],
        }),
      }),
    );
    expect(withGoal.emptyNote).toBeNull();
    expect(withGoal.rows.some((r) => r.title === "New roof")).toBe(true);
  });
});
