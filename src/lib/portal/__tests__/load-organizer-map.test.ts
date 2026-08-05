import { describe, it, expect, vi, beforeEach } from "vitest";

// Each schema-import access returns a unique sentinel so we can branch in the db mock.
vi.mock("@/db/schema", () => ({
  clients: { _name: "clients" },
  crmHouseholdContacts: { _name: "crmHouseholdContacts" },
  entities: { _name: "entities" },
  familyMembers: { _name: "familyMembers" },
  scenarios: { _name: "scenarios" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  asc: (...a: unknown[]) => a,
}));

// ---------- configurable mock state ----------
let mockClient: Record<string, unknown> | undefined = {
  firmId: "firm-1",
  crmHouseholdId: "hh-1",
  lifeExpectancy: 90,
  portalEditEnabled: true,
};
let mockScenarios: { id: string }[] = [{ id: "s-base" }];
let mockContacts: { role: string; dateOfBirth: string | null }[] = [
  { role: "primary", dateOfBirth: "1976-04-01" },
];
const mockFamilyMembers = [
  { id: "fm-1", role: "client", firstName: "Cooper", dateOfBirth: "1976-04-01" },
];
const mockEntities: { id: string; name: string }[] = [];

function rowsFor(table: string): unknown[] {
  switch (table) {
    case "clients":
      return mockClient ? [mockClient] : [];
    case "scenarios":
      return mockScenarios;
    case "crmHouseholdContacts":
      return mockContacts;
    case "familyMembers":
      return mockFamilyMembers;
    case "entities":
      return mockEntities;
    default:
      return [];
  }
}

/**
 * Every link is itself awaitable AND returns a fresh link, so the fake is
 * order-independent: `.where()`, `.where().limit()` and `.where().orderBy()`
 * all resolve to the same rows. `load-accounts-page.test.ts` branches on the
 * terminator instead — its `.where()` returns either a `{ limit }` or a
 * `{ then }`, and neither object carries an `orderBy` property. That shape
 * cannot serve this loader, which mixes all three terminators: the two queries
 * ending in `.orderBy()` would throw `TypeError: ....orderBy is not a function`
 * at call time.
 */
function chainFor(rows: unknown[]) {
  const link = {
    where: () => chainFor(rows),
    orderBy: () => chainFor(rows),
    limit: () => chainFor(rows),
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  return link;
}

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: (tbl: { _name: string }) => chainFor(rowsFor(tbl._name)) }),
  },
}));

// `vi.hoisted` is required, not stylistic: Vite hoists the `../load-organizer-map`
// import above this file's `const`s, so a bare `const loadEffectiveTree = vi.fn()`
// would still be in its temporal dead zone when the loader pulls in the mocked
// `@/lib/scenario/loader` and the factory dereferences it.
const { loadEffectiveTree } = vi.hoisted(() => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree }));

const BASE_TREE = {
  client: {
    firstName: "Cooper",
    spouseName: null as string | null,
    retirementAge: 65,
    planEndAge: 95,
    lifeExpectancy: 90,
    spouseRetirementAge: null as number | null,
    spouseLifeExpectancy: null as number | null,
  },
  planSettings: { planStartYear: 2026, planEndYear: 2066 },
  accounts: [],
  liabilities: [],
  incomes: [],
  savingsRules: [],
  expenses: [],
};

loadEffectiveTree.mockResolvedValue({ effectiveTree: BASE_TREE, warnings: [] });

import { loadOrganizerMap } from "../load-organizer-map";

const CLIENT_ID = "client-1";

// ---------- editor-hydration fixtures (Task 4) ----------
const SS_INCOME_ID = "inc-ss-1";
const POLICY_PREMIUM_ID = "premium-1";
const ENTITY_INCOME_ID = "inc-entity-1";
const TAXABLE_ACCOUNT_ID = "acct-taxable-1";
const DEFAULT_CHECKING_ID = "acct-checking-1";
const LIFE_INSURANCE_ACCOUNT_ID = "acct-life-insurance-1";

/**
 * One effective tree exercising every editor-hydration exclusion at once: a
 * social-security income (excluded from incomeRows but still a card), a
 * synthesized policy-premium expense (excluded from expenseRows but still a
 * card), an entity-owned income (excluded, tray-owned), and three accounts
 * spanning the portal visibility gate. Also carries a spouse whose life
 * expectancy lands LATER than the client's, so the milestones test below is
 * discriminating rather than trivially true. Reused across the five tests
 * below instead of one bespoke tree per case, the same way `BASE_TREE` is
 * shared above.
 */
function buildRichFixture() {
  return {
    ...BASE_TREE,
    client: { ...BASE_TREE.client, spouseName: "Riley", spouseLifeExpectancy: 90 },
    accounts: [
      {
        id: TAXABLE_ACCOUNT_ID,
        name: "Taxable Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: 250_000,
        basis: 200_000,
        growthRate: 0.06,
        rmdEnabled: false,
        titlingType: "individual",
        owners: [],
        isDefaultChecking: false,
        parentAccountId: null,
      },
      {
        id: DEFAULT_CHECKING_ID,
        name: "Household Cash",
        category: "cash",
        subType: "checking",
        value: 15_000,
        basis: 15_000,
        growthRate: 0,
        rmdEnabled: false,
        titlingType: "individual",
        owners: [],
        isDefaultChecking: true,
        parentAccountId: null,
      },
      {
        id: LIFE_INSURANCE_ACCOUNT_ID,
        name: "Whole Life Policy",
        category: "life_insurance",
        subType: "whole_life",
        value: 50_000,
        basis: 40_000,
        growthRate: 0.03,
        rmdEnabled: false,
        titlingType: "individual",
        owners: [],
        isDefaultChecking: false,
        parentAccountId: null,
      },
    ],
    incomes: [
      {
        id: SS_INCOME_ID,
        type: "social_security",
        name: "Client Social Security",
        annualAmount: 28_000,
        startYear: 2026,
        endYear: 2066,
        growthRate: 0.02,
        owner: "client",
      },
      {
        id: ENTITY_INCOME_ID,
        type: "business",
        name: "Consulting LLC income",
        annualAmount: 60_000,
        startYear: 2026,
        endYear: 2041,
        growthRate: 0.02,
        owner: "client",
        ownerEntityId: "ent-1",
      },
    ],
    expenses: [
      {
        id: POLICY_PREMIUM_ID,
        type: "insurance",
        name: "Policy premium",
        annualAmount: 4_800,
        startYear: 2026,
        endYear: 2050,
        growthRate: 0,
        source: "policy",
        sourcePolicyAccountId: LIFE_INSURANCE_ACCOUNT_ID,
      },
    ],
  };
}

describe("loadOrganizerMap", () => {
  beforeEach(() => {
    mockClient = {
      firmId: "firm-1",
      crmHouseholdId: "hh-1",
      lifeExpectancy: 90,
      portalEditEnabled: true,
    };
    mockScenarios = [{ id: "s-base" }];
    mockContacts = [{ role: "primary", dateOfBirth: "1976-04-01" }];
    loadEffectiveTree.mockClear();
  });

  it("resolves the BASE tree, never a scenario", async () => {
    await loadOrganizerMap("client-1");
    expect(loadEffectiveTree).toHaveBeenCalledWith("client-1", "firm-1", "base", {});
  });

  it("returns null when the client has no base-case scenario", async () => {
    mockScenarios = [];
    expect(await loadOrganizerMap("client-1")).toBeNull();
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("returns null when the primary contact has no date of birth", async () => {
    mockContacts = [{ role: "primary", dateOfBirth: null as unknown as string }];
    expect(await loadOrganizerMap("client-1")).toBeNull();
  });

  it("reports canEdit from portalEditEnabled", async () => {
    mockClient = { ...mockClient!, portalEditEnabled: false };
    expect((await loadOrganizerMap("client-1"))!.canEdit).toBe(false);
  });

  /**
   * `buildMapBoards` builds `items` from all five spreads, and `CashFlowBoard`
   * drops the account and liability cards at RENDER — but the board is a
   * `"use client"` component, so the whole array crosses the server→client
   * boundary into the RSC Flight payload before any of that. A render-time
   * filter would still have shipped every hidden account's name and balance to
   * the client's browser, which is why the filter is in the loader.
   *
   * The account here is a `business` one — one of the categories
   * `./account-visibility.ts` names advisor-only.
   */
  it("returns only the three flow kinds, never account or liability cards", async () => {
    loadEffectiveTree.mockResolvedValueOnce({
      effectiveTree: {
        ...BASE_TREE,
        accounts: [
          {
            id: "a1",
            name: "Reid Consulting LLC",
            category: "business",
            subType: "business",
            value: 1_400_000,
            basis: 0,
            growthRate: 0.05,
            rmdEnabled: false,
            titlingType: "individual",
            owners: [],
          },
        ],
        liabilities: [
          {
            id: "l1",
            name: "Mortgage",
            balance: 420_000,
            interestRate: 0.055,
            monthlyPayment: 2_400,
            startYear: 2020,
            startMonth: 1,
            termMonths: 360,
            extraPayments: [],
            owners: [],
          },
        ],
        incomes: [
          {
            id: "i1",
            type: "salary",
            name: "Salary",
            annualAmount: 180_000,
            startYear: 2026,
            endYear: 2041,
            growthRate: 0.03,
            owner: "client",
          },
        ],
        expenses: [
          {
            id: "e1",
            type: "living",
            name: "Living expenses",
            annualAmount: 90_000,
            startYear: 2026,
            endYear: 2066,
            growthRate: 0.025,
          },
        ],
      },
      warnings: [],
    });

    const { items } = (await loadOrganizerMap("client-1"))!;

    // The flow half first, so this cannot pass on an empty array.
    expect(items.map((i) => i.id).sort()).toEqual(["e1", "i1"]);
    expect(items.some((i) => i.kind === "account" || i.kind === "liability")).toBe(false);
    // The payload assertion the two above are proxies for: the hidden account's
    // NAME is the thing that must not reach the browser.
    expect(JSON.stringify(items)).not.toContain("Reid Consulting LLC");
  });

  it("carries the spouse CRM contact's date of birth onto the board", async () => {
    mockContacts = [
      { role: "primary", dateOfBirth: "1976-04-01" },
      { role: "spouse", dateOfBirth: "1978-09-15" },
    ];
    loadEffectiveTree.mockResolvedValueOnce({
      effectiveTree: {
        ...BASE_TREE,
        client: { ...BASE_TREE.client, spouseName: "Riley", spouseLifeExpectancy: 90 },
      },
      warnings: [],
    });

    const data = (await loadOrganizerMap("client-1"))!;

    // Both assertions turn on the spouse BIRTH YEAR, which reaches
    // `buildMapBoards` only through `identity.spouseDob`. Asserting
    // `people.spouse` is merely non-null would NOT hold this line: that node is
    // gated on the tree's `spouseName` alone and survives `spouseDob = null`.
    expect(data.people.spouse?.birthYear).toBe(1978);
    // The milestone that silently disappears when the spouse DOB is dropped —
    // gated on spouse name + birth year in `lifeExpectancyMilestones`.
    expect(data.goals.find((g) => g.id === "milestone:spouse_life_expectancy")).toMatchObject({
      year: 2068, // 1978 + 90
      side: "spouse",
    });
  });

  describe("editor hydration", () => {
    beforeEach(() => {
      mockContacts = [
        { role: "primary", dateOfBirth: "1976-04-01" },
        { role: "spouse", dateOfBirth: "1978-09-15" },
      ];
      loadEffectiveTree.mockResolvedValueOnce({ effectiveTree: buildRichFixture(), warnings: [] });
    });

    it("omits a social-security income from incomeRows while keeping its card", async () => {
      // The SS card must still appear on the board and in the Income subtotal —
      // it is real income. It just must not be editable from the portal.
      const data = await loadOrganizerMap(CLIENT_ID);
      expect(data).not.toBeNull();
      expect(data!.items.some((i) => i.id === SS_INCOME_ID)).toBe(true);
      expect(SS_INCOME_ID in data!.incomeRows).toBe(false);
    });

    it("omits a synthesized policy premium from expenseRows while keeping its card", async () => {
      const data = await loadOrganizerMap(CLIENT_ID);
      expect(data!.items.some((i) => i.id === POLICY_PREMIUM_ID)).toBe(true);
      expect(POLICY_PREMIUM_ID in data!.expenseRows).toBe(false);
    });

    it("omits an entity-owned income from incomeRows", async () => {
      const data = await loadOrganizerMap(CLIENT_ID);
      expect(ENTITY_INCOME_ID in data!.incomeRows).toBe(false);
    });

    it("offers only portal-visible accounts as savings targets", async () => {
      const data = await loadOrganizerMap(CLIENT_ID);
      const ids = data!.savingsAccountOptions.map((a) => a.id);
      expect(ids).toContain(TAXABLE_ACCOUNT_ID);
      expect(ids).not.toContain(DEFAULT_CHECKING_ID);
      expect(ids).not.toContain(LIFE_INSURANCE_ACCOUNT_ID);
    });

    it("derives milestones with planEnd at the LATER life expectancy", async () => {
      const data = await loadOrganizerMap(CLIENT_ID);
      expect(data!.milestones.planEnd).toBe(
        Math.max(data!.milestones.clientEnd, data!.milestones.spouseEnd ?? 0),
      );
    });
  });
});
