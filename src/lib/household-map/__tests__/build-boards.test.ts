// src/lib/household-map/__tests__/build-boards.test.ts
import { describe, it, expect } from "vitest";
import { buildMapBoards } from "../build-boards";
import type { MapBoardsInput } from "../build-boards";
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
import type { EquityGrant, StockOptionPlan } from "@/engine/equity/types";

// Fully typed fixtures, no casts — the same idiom as `map-items.test.ts`. A cast
// to `MapBoardsInput` would hide a field-shape drift between this fixture and
// the engine `ClientData` the real caller passes, which is the one thing this
// module's tests exist to catch.
//
// Every number is picked so exactly ONE derivation reaches it. Most of this
// builder is a wiring layer, and a wiring assertion that two hypotheses satisfy
// proves nothing:
//
//   · Cooper is born 1976 with `planEndAge` 95, so the plan ends in 2071 while
//     his life-expectancy card sits at 2066 — a year no milestone shares.
//   · The tree's life expectancy is 90 and `identity`'s is 85, so the builder's
//     `effectiveClient.lifeExpectancy ?? identity.lifeExpectancy` is observable
//     from outside and a swapped `??` reads a different year.
//   · Riley retires at 60 (2039) where Cooper retires at 65 (2041), and her life
//     expectancy is 88 (2067) against his 90 (2066), so any spouse field
//     accidentally sourced from the client lands on the wrong year.

const CLIENT_DOB = "1976-04-01";
const SPOUSE_DOB = "1979-09-15";

const clientInfo = (over: Partial<ClientInfo> = {}): ClientInfo => ({
  firstName: "Cooper",
  lastName: "Reid",
  dateOfBirth: CLIENT_DOB,
  retirementAge: 65,
  planEndAge: 95,
  lifeExpectancy: 90,
  filingStatus: "single",
  ...over,
});

/** The same household, married. `spouseName` is the single field the whole
 *  spouse person-node hangs off — see the `spouseFirstName` note in
 *  `build-boards.ts`. */
const marriedClientInfo = (over: Partial<ClientInfo> = {}): ClientInfo =>
  clientInfo({
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

const income = (over: Partial<Income> = {}): Income => ({
  id: "i1",
  type: "salary",
  name: "Salary",
  annualAmount: 180_000,
  startYear: 2026,
  endYear: 2041,
  growthRate: 0.03,
  owner: "client",
  ...over,
});

/** An UNCLAIMED Social Security benefit. Claiming at 70 against a 1976 DOB
 *  first pays in 2046, long after the 2026 plan start, so `ssStartNote` has a
 *  claim age to name; the persisted 2024–2099 window is the inert one the
 *  engine ignores and the card must not quote. */
const socialSecurity = (over: Partial<Income> = {}): Income =>
  income({
    id: "ss1",
    type: "social_security",
    name: "Cooper's Social Security",
    annualAmount: 48_000,
    startYear: 2024,
    endYear: 2099,
    claimingAgeMode: "years",
    claimingAge: 70,
    ssBenefitMode: "manual_amount",
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
  name: "New roof",
  annualAmount: 40_000,
  startYear: 2030,
  endYear: 2030,
  growthRate: 0,
  isGoal: true,
  source: "manual",
  ...over,
});

/** One row of every kind the boards draw, so deleting any one of the five
 *  spreads in `buildMapBoards` reddens a test. */
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
    ...over,
  };
}

type FamilyMemberRow = MapBoardsInput["familyMemberRows"][number];

const clientRow: FamilyMemberRow = {
  id: "fm-1",
  role: "client",
  firstName: "Cooper",
  dateOfBirth: CLIENT_DOB,
};
const spouseRow: FamilyMemberRow = {
  id: "fm-2",
  role: "spouse",
  firstName: "Riley",
  dateOfBirth: SPOUSE_DOB,
};

function input(overrides: Partial<MapBoardsInput> = {}): MapBoardsInput {
  return {
    effectiveTree: tree(),
    identity: { dateOfBirth: CLIENT_DOB, spouseDob: null, lifeExpectancy: 85 },
    familyMemberRows: [clientRow],
    entityRows: [],
    today: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

/** The same household married, with the spouse present in all three places the
 *  builder reads one from: the effective tree, `identity`, and the family-member
 *  rows. */
function marriedInput(overrides: Partial<MapBoardsInput> = {}): MapBoardsInput {
  return input({
    effectiveTree: tree({ client: marriedClientInfo() }),
    identity: { dateOfBirth: CLIENT_DOB, spouseDob: SPOUSE_DOB, lifeExpectancy: 85 },
    familyMemberRows: [clientRow, spouseRow],
    ...overrides,
  });
}

describe("buildMapBoards", () => {
  it("nets assets against debts", () => {
    expect(buildMapBoards(input()).netWorth).toBe(300_000);
  });

  it("emits one card per account, liability, income, savings rule and expense", () => {
    const { items } = buildMapBoards(input());
    expect(items.map((i) => i.id).sort()).toEqual(["a1", "e1", "i1", "l1", "s1"]);
  });

  it("signs outflows negative so band subtotals net out", () => {
    const { items } = buildMapBoards(input());
    expect(items.find((i) => i.id === "e1")!.value).toBe(-40_000);
    expect(items.find((i) => i.id === "l1")!.value).toBe(-200_000);
    // A contribution leaves household cash flow just like an expense does.
    expect(items.find((i) => i.id === "s1")!.value).toBe(-23_000);
    // The pair is the point: an inflow keeps its sign, so this cannot pass on a
    // blanket negation.
    expect(items.find((i) => i.id === "i1")!.value).toBe(180_000);
  });

  // The 4th argument to `incomeToMapItem` — one of the rulings that had to
  // survive the extraction. An SS row's persisted years are inert (the engine
  // pays from the resolved CLAIM AGE), so the card names the age instead. Drop
  // the argument and `startsAt` goes null.
  it("names an unclaimed Social Security benefit's claim age instead of its inert years", () => {
    const { items } = buildMapBoards(
      input({ effectiveTree: tree({ incomes: [income(), socialSecurity()] }) }),
    );
    expect(items.find((i) => i.id === "ss1")!.timing?.startsAt).toEqual({
      label: "at 70",
      title: "Benefit starts at age 70 (2046)",
    });
    // Every other income keeps its year range — the note is not blanket.
    expect(items.find((i) => i.id === "i1")!.timing?.startsAt).toBeNull();
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
    // 2066, from the TREE's 90 — not the plan's 2071 end, and not `identity`'s 85.
    expect(le!.year).toBe(1976 + 90);
  });

  it("falls back to the caller's life expectancy only when the tree carries none", () => {
    const { goals } = buildMapBoards(
      input({ effectiveTree: tree({ client: clientInfo({ lifeExpectancy: undefined }) }) }),
    );
    const le = goals.find((g) => g.lifeExpectancy?.owner === "client");
    expect(le!.year).toBe(1976 + 85);
  });

  it("derives ages from `today`, never the wall clock", () => {
    const { people } = buildMapBoards(input({ today: new Date("2040-06-01T00:00:00Z") }));
    expect(people.client.age).toBe(64);
  });

  it("returns no spouse node when the tree carries no spouse name", () => {
    expect(buildMapBoards(input()).people.spouse).toBeNull();
  });

  it("builds the spouse node from the spouse's own DOB, row and retirement age", () => {
    expect(buildMapBoards(marriedInput()).people.spouse).toEqual({
      familyMemberId: "fm-2",
      firstName: "Riley",
      // Born Sept 1979, so on 1 June 2026 she is still 46 — a year under the
      // calendar difference, and four years off Cooper's 50.
      age: 46,
      retirementYear: 2039,
      birthYear: 1979,
    });
  });

  // The other surviving ruling: the goals board's spouse name, birth year and
  // life expectancy come from the SAME spouse the person node above does, so a
  // card's year can never disagree with the node beside it.
  it("carries the spouse's own name, birth year and life expectancy onto the goals board", () => {
    const { goals } = buildMapBoards(marriedInput());
    expect(goals.find((g) => g.lifeExpectancy?.owner === "spouse")).toMatchObject({
      title: "Riley's life expectancy",
      year: 2067,
    });
  });
});

/** A stock_options account's `value` column is a permanent "0" — the shares
 *  live in the grants table. The boards read the account, so without a
 *  derivation the Map draws a real position as a $0 card and understates net
 *  worth by its whole value. */
describe("buildMapBoards — stock_options accounts", () => {
  const rsuGrant: EquityGrant = {
    id: "g1",
    grantNumber: "RS-1",
    grantType: "rsu",
    grantDate: "2024-01-15",
    sharesGranted: 1000,
    has83bElection: false,
    fmvAtGrant: null,
    strikePrice: null,
    strikeDiscountPct: null,
    expirationYear: null,
    strategy: null,
    tranches: [
      // Nothing exercised, so there is no pre-plan acquisition to record.
      { id: "t1", vestDate: "2030-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0,
        acquiredOn: null, priceAtAcquisition: null, strategy: null },
    ],
    plannedEvents: [],
  };

  const equityPlan: StockOptionPlan = {
    accountId: "so-1",
    ticker: "TSLA",
    pricePerShare: 100,
    growthRate: 0,
    destinationAccountId: null,
    autoCreateDestination: true,
    sellToCover: false,
    withholdingRate: 0.22,
    strategy: {
      exerciseTiming: "at_vest",
      exerciseYear: null,
      sellTiming: "hold",
      sellYear: null,
      sellPercentPerYear: null,
      sellStartYear: null,
    },
    owner: "client",
    grants: [rsuGrant],
  };

  const equityAccount = account({
    id: "so-1",
    name: "TSLA Options",
    category: "stock_options",
    subType: "rsu",
    value: 0,
    basis: 0,
  });

  const equityInput = () =>
    input({
      effectiveTree: tree({
        accounts: [account(), equityAccount],
        stockOptionPlans: [equityPlan],
      }),
    });

  it("draws the card at the value of the shares still under grant, not the stored 0", () => {
    const { items } = buildMapBoards(equityInput());
    expect(items.find((i) => i.id === "so-1")?.value).toBe(100_000);
  });

  it("counts that same derived value in net worth", () => {
    // 500,000 brokerage + 100,000 of unvested RSU − 200,000 mortgage.
    expect(buildMapBoards(equityInput()).netWorth).toBe(400_000);
  });

  it("leaves a stock_options account with no grants entered at 0", () => {
    const { items, netWorth } = buildMapBoards(
      input({ effectiveTree: tree({ accounts: [account(), equityAccount] }) }),
    );
    expect(items.find((i) => i.id === "so-1")?.value).toBe(0);
    expect(netWorth).toBe(300_000);
  });
});
