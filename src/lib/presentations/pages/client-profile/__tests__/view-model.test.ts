import { describe, it, expect } from "vitest";
import { buildClientProfileData } from "../view-model";
import type { BuildClientProfileInput } from "../types";
import type { ClientData, ProjectionYear } from "@/engine/types";

// Minimal ProjectionYear fixture — the view-model only reads year, ages,
// income.bySource, and the expenses buckets, so we cast a partial.
function py(partial: {
  year: number;
  ageClient?: number;
  ageSpouse?: number;
  bySource?: Record<string, number>;
  expenses?: Partial<ProjectionYear["expenses"]>;
}): ProjectionYear {
  return {
    year: partial.year,
    ages: { client: partial.ageClient ?? 0, spouse: partial.ageSpouse },
    income: { bySource: partial.bySource ?? {} },
    expenses: {
      living: 0, liabilities: 0, other: 0, insurance: 0, realEstate: 0,
      taxes: 0, cashGifts: 0, discretionary: 0, total: 0, bySource: {},
      byLiability: {},
      ...partial.expenses,
    },
  } as unknown as ProjectionYear;
}

function clientData(overrides: Partial<ClientData["client"]>, rest: Partial<ClientData> = {}): ClientData {
  return {
    client: {
      firstName: "John", lastName: "Smith",
      dateOfBirth: "1968-03-12", retirementAge: 65, planEndAge: 92,
      lifeExpectancy: 90, filingStatus: "married_joint",
      ...overrides,
    },
    accounts: [], incomes: [], expenses: [], liabilities: [],
    ...rest,
  } as unknown as ClientData;
}

const base: Omit<BuildClientProfileInput, "clientData"> = {
  years: [py({ year: 2026, ageClient: 58, ageSpouse: 56 })],
  scenarioLabel: "Base Case",
  clientName: "John Smith",
  spouseName: "Jane Smith",
  spouseLastName: null,
};

describe("buildClientProfileData — persons", () => {
  it("builds two cards for a couple", () => {
    const data = buildClientProfileData({
      ...base,
      clientData: clientData({
        spouseName: "Jane Smith", spouseDob: "1970-07-04",
        spouseRetirementAge: 63, spouseLifeExpectancy: 94,
      }),
    });
    expect(data.persons).toHaveLength(2);
    expect(data.persons[0]).toMatchObject({
      name: "John Smith", age: 58, retirementAge: 65,
      retirementYear: 2033, lifeExpectancyAge: 90, lifeExpectancyYear: 2058,
    });
    expect(data.persons[1]).toMatchObject({
      name: "Jane Smith", age: 56, retirementAge: 63,
      retirementYear: 2033, lifeExpectancyAge: 94, lifeExpectancyYear: 2064,
    });
  });

  it("appends the spouse's surname when it differs from the primary's", () => {
    const data = buildClientProfileData({
      ...base,
      spouseName: "Teresa",
      spouseLastName: "Cox",
      clientData: clientData({
        spouseName: "Teresa", spouseDob: "1970-07-04",
        spouseRetirementAge: 63, spouseLifeExpectancy: 94,
      }),
    });
    expect(data.persons[1]).toMatchObject({ name: "Teresa Cox" });
  });

  it("builds one card for a single client and falls back to planEndAge", () => {
    const data = buildClientProfileData({
      ...base,
      spouseName: null,
      clientData: clientData({ lifeExpectancy: undefined, filingStatus: "single" }),
    });
    expect(data.persons).toHaveLength(1);
    expect(data.persons[0]).toMatchObject({
      name: "John Smith", lifeExpectancyAge: 92, lifeExpectancyYear: 2060,
    });
  });
});

describe("buildClientProfileData — children", () => {
  it("includes role:child members with age, omits non-children", () => {
    const data = buildClientProfileData({
      ...base,
      clientData: clientData({}, {
        familyMembers: [
          { id: "1", role: "child", relationship: "child", firstName: "Emma", lastName: "Smith", dateOfBirth: "2013-01-01" },
          { id: "2", role: "child", relationship: "child", firstName: "Liam", lastName: null, dateOfBirth: null },
          { id: "3", role: "other", relationship: "parent", firstName: "Pat", lastName: "Smith", dateOfBirth: "1945-01-01" },
        ] as ClientData["familyMembers"],
      }),
    });
    expect(data.children).toHaveLength(2);
    expect(data.children[0]).toMatchObject({ name: "Emma Smith", age: 13 });
    expect(data.children[1]).toMatchObject({ name: "Liam", dob: null, age: null });
  });

  it("includes UI-entered children where relationship is child but role defaulted to other", () => {
    // The family-member form never sets `role`, so UI-entered children land in
    // the DB as role:"other". Children must populate off `relationship`.
    const data = buildClientProfileData({
      ...base,
      clientData: clientData({}, {
        familyMembers: [
          { id: "1", role: "other", relationship: "child", firstName: "Emma", lastName: "Smith", dateOfBirth: "2013-01-01" },
          { id: "2", role: "other", relationship: "stepchild", firstName: "Noah", lastName: "Smith", dateOfBirth: "2015-01-01" },
          { id: "3", role: "other", relationship: "parent", firstName: "Pat", lastName: "Smith", dateOfBirth: "1945-01-01" },
        ] as ClientData["familyMembers"],
      }),
    });
    expect(data.children).toHaveLength(2);
    expect(data.children.map((c) => c.name)).toEqual(["Emma Smith", "Noah Smith"]);
  });

  it("never renders the household principals (role client/spouse) as children", () => {
    // Household rows carry the schema default relationship:"child" unless a
    // creation path overrides it. The `role` column is authoritative — client
    // and spouse are person cards, never child cards.
    const data = buildClientProfileData({
      ...base,
      clientData: clientData({}, {
        familyMembers: [
          { id: "c", role: "client", relationship: "child", firstName: "John", lastName: "Smith", dateOfBirth: "1968-03-12" },
          { id: "s", role: "spouse", relationship: "child", firstName: "Jane", lastName: "Smith", dateOfBirth: "1970-07-04" },
          { id: "1", role: "other", relationship: "child", firstName: "Emma", lastName: "Smith", dateOfBirth: "2013-01-01" },
        ] as ClientData["familyMembers"],
      }),
    });
    expect(data.children.map((c) => c.name)).toEqual(["Emma Smith"]);
  });

  it("returns empty children when none present", () => {
    const data = buildClientProfileData({ ...base, clientData: clientData({}) });
    expect(data.children).toEqual([]);
  });
});

describe("buildClientProfileData — social security", () => {
  it("shows the resolved claim year as start and PIA×12 as the annual amount", () => {
    // SS row is anchored at plan start (2020) but the client doesn't claim until
    // age 67. The Start column must show the claim year (2035), not "Active", and
    // the amount must be PIA×12 ($43,200), not the $0 the engine emits pre-claim.
    const years = [
      py({ year: 2026, ageClient: 58, bySource: { ss: 0 } }),
      py({ year: 2035, ageClient: 67, bySource: { ss: 41000 } }),
    ];
    const data = buildClientProfileData({
      ...base,
      years,
      clientData: clientData({ dateOfBirth: "1968-03-12" }, {
        incomes: [
          {
            id: "ss", type: "social_security", name: "SS — John", annualAmount: 0,
            startYear: 2020, endYear: 2060, owner: "client", growthRate: 0,
            ssBenefitMode: "pia_at_fra", piaMonthly: 3600, claimingAge: 67, claimingAgeMode: "years",
          },
        ] as ClientData["incomes"],
      }),
    });
    const ss = data.income.find((r) => r.name === "SS — John")!;
    expect(ss).toMatchObject({ active: false, startYear: 2035, amount: 43200 });
  });

  it("treats SS as active when the client is already past the claim age", () => {
    const years = [py({ year: 2026, ageClient: 68, bySource: { ss: 40000 } })];
    const data = buildClientProfileData({
      ...base,
      years,
      clientData: clientData({ dateOfBirth: "1958-03-12" }, {
        incomes: [
          {
            id: "ss", type: "social_security", name: "SS — John", annualAmount: 0,
            startYear: 2020, endYear: 2060, owner: "client", growthRate: 0,
            ssBenefitMode: "pia_at_fra", piaMonthly: 3000, claimingAge: 67, claimingAgeMode: "years",
          },
        ] as ClientData["incomes"],
      }),
    });
    const ss = data.income.find((r) => r.name === "SS — John")!;
    // born 1958, claim 67 -> claim year 2025, before firstYear 2026 -> active
    expect(ss).toMatchObject({ active: true, startYear: 2025, amount: 36000 });
  });
});

describe("buildClientProfileData — income", () => {
  it("labels active vs future income, end-year sentinel, and amount-at-start", () => {
    const years = [
      py({ year: 2026, ageClient: 58, bySource: { sal: 120000, pen: 0 } }),
      py({ year: 2033, ageClient: 65, bySource: { sal: 0, pen: 30000 } }),
      py({ year: 2040, ageClient: 72, bySource: {} }),
    ];
    const data = buildClientProfileData({
      ...base,
      years,
      clientData: clientData({}, {
        incomes: [
          { id: "sal", type: "salary", name: "John Salary", annualAmount: 120000, startYear: 2020, endYear: 2032, owner: "client", growthRate: 0 },
          { id: "pen", type: "deferred", name: "Pension", annualAmount: 30000, startYear: 2033, endYear: 2060, owner: "client", growthRate: 0 },
        ] as ClientData["incomes"],
      }),
    });
    const sal = data.income.find((r) => r.name === "John Salary")!;
    const pen = data.income.find((r) => r.name === "Pension")!;
    expect(sal).toMatchObject({ typeLabel: "Salary", amount: 120000, active: true, endYear: 2032 });
    // startYear 2033 -> not active; amount read from the 2033 projection year
    expect(pen).toMatchObject({ typeLabel: "Deferred Comp", amount: 30000, active: false, startYear: 2033 });
    // endYear 2060 >= last projection year (2040) -> runs through plan end
    expect(pen.endYear).toBeNull();
  });
});

describe("buildClientProfileData — expenses", () => {
  const years = [
    py({ year: 2026, expenses: { living: 52400, taxes: 41000, insurance: 6000, total: 99400 } }),
    py({ year: 2033, expenses: { living: 60000, taxes: 22000, insurance: 6000, total: 88000 } }),
  ];

  it("emits non-zero buckets and a Total tying to expenses.total in both columns", () => {
    const data = buildClientProfileData({ ...base, years, clientData: clientData({}) });
    const labels = data.expenses.map((r) => r.label);
    expect(labels).toContain("Living");
    expect(labels).toContain("Taxes");
    expect(labels).toContain("Insurance");
    expect(labels).not.toContain("Real Estate"); // zero in both columns -> omitted
    const total = data.expenses.find((r) => r.isTotal)!;
    expect(total).toMatchObject({ current: 99400, retirement: 88000 });
    // Current column = first projection year; Retirement column = retirement year (2033)
    const living = data.expenses.find((r) => r.label === "Living")!;
    expect(living).toMatchObject({ current: 52400, retirement: 60000 });
  });

  it("anchors the Retirement column to the LAST spouse to retire, not the first", () => {
    // Spouse retires (2031) before the client (2033). The Retirement column must
    // sample the client's later retirement year so the retirement-phase living
    // expense is fully active — sampling the earlier year would show current $.
    const coupleYears = [
      py({ year: 2026, expenses: { living: 52400, total: 52400 } }),
      py({ year: 2031, expenses: { living: 53000, total: 53000 } }), // spouse retires — not yet retirement-living
      py({ year: 2033, expenses: { living: 60000, total: 60000 } }), // both retired
    ];
    const data = buildClientProfileData({
      ...base,
      years: coupleYears,
      clientData: clientData({ spouseDob: "1970-07-04", spouseRetirementAge: 61 }), // spouse retires 2031
    });
    const living = data.expenses.find((r) => r.label === "Living")!;
    expect(living).toMatchObject({ current: 52400, retirement: 60000 });
  });

  it("falls back to the last projection year when already retired (no retirement year ahead)", () => {
    // client already past retirement: retirementYear 2033 but projection starts 2034
    const lateYears = [
      py({ year: 2034, expenses: { living: 60000, total: 60000 } }),
      py({ year: 2035, expenses: { living: 61000, total: 61000 } }),
    ];
    const data = buildClientProfileData({ ...base, years: lateYears, clientData: clientData({}) });
    const total = data.expenses.find((r) => r.isTotal)!;
    // retirement year 2033 < first projection year -> use first year >= 2033 = 2034
    expect(total.current).toBe(60000);
    expect(total.retirement).toBe(60000);
  });
});
