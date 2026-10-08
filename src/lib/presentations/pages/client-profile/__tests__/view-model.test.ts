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

  it("appends the Co-client's surname when it differs from the primary's", () => {
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

  it("starts a claim at a fractional age in the year the first check arrives", () => {
    // Born March 1968, claims at 67y 6mo -> first payment in late 2035, not 2036.
    const data = buildClientProfileData({
      ...base,
      clientData: clientData({ dateOfBirth: "1968-03-12" }, {
        incomes: [
          {
            id: "ss", type: "social_security", name: "SS — John", annualAmount: 0,
            startYear: 2020, endYear: 2060, owner: "client", growthRate: 0,
            ssBenefitMode: "pia_at_fra", piaMonthly: 3600, claimingAge: 67, claimingAgeMonths: 6,
            claimingAgeMode: "years",
          },
        ] as ClientData["incomes"],
      }),
    });
    expect(data.income.find((r) => r.name === "SS — John")!.startYear).toBe(2035);
  });

  describe("a co-client drawing a spousal benefit", () => {
    // John (1968, FRA 67) claims at 67 in 2035; Jane (1970, FRA 67) at 67 in 2037.
    const couple = (janePia: number) =>
      clientData(
        { dateOfBirth: "1968-03-12", spouseName: "Jane", spouseDob: "1970-07-04", spouseLifeExpectancy: 94 },
        {
          incomes: [
            {
              id: "ss-john", type: "social_security", name: "SS — John", annualAmount: 0,
              startYear: 2020, endYear: 2060, owner: "client", growthRate: 0.02,
              ssBenefitMode: "pia_at_fra", piaMonthly: 3600, claimingAge: 67, claimingAgeMode: "years",
            },
            {
              id: "ss-jane", type: "social_security", name: "SS — Jane", annualAmount: 0,
              startYear: 2020, endYear: 2064, owner: "spouse", growthRate: 0.02,
              ssBenefitMode: "pia_at_fra", piaMonthly: janePia, claimingAge: 67, claimingAgeMode: "years",
            },
          ] as ClientData["incomes"],
        },
      );

    it("shows the spousal benefit as the amount when the co-client has no work record", () => {
      const data = buildClientProfileData({ ...base, clientData: couple(0) });
      const jane = data.income.find((r) => r.name === "SS — Jane")!;
      // Half of John's $3,600 PIA at Jane's FRA = $1,800/mo, in today's dollars.
      expect(jane).toMatchObject({
        typeLabel: "Social Security (spousal)",
        amount: 21600,
        startYear: 2037,
        active: false,
      });
      expect(data.incomeNotes).toEqual([
        "Jane draws a spousal benefit of $21,600/yr on John's work record, starting in 2037 once both have filed.",
      ]);
    });

    it("waits for the other spouse to file before a pure spousal benefit starts", () => {
      // Jane claims at 62 (2032) but John not until 70 (2038): nothing is paid
      // until John files, so the row cannot read 2032.
      const cd = couple(0);
      cd.incomes[0].claimingAge = 70;
      cd.incomes[1].claimingAge = 62;
      const jane = buildClientProfileData({ ...base, clientData: cd }).income.find((r) => r.name === "SS — Jane")!;
      expect(jane.startYear).toBe(2038);
      expect(jane.typeLabel).toBe("Social Security (spousal)");
    });

    it("adds a spousal top-up to a smaller own benefit and says so", () => {
      const data = buildClientProfileData({ ...base, clientData: couple(1000) });
      const jane = data.income.find((r) => r.name === "SS — Jane")!;
      // Own $1,000/mo + top-up ($1,800 − $1,000) = $800/mo -> $12,000 + $9,600.
      expect(jane).toMatchObject({ typeLabel: "Social Security + spousal", amount: 21600, startYear: 2037 });
      expect(data.incomeNotes).toEqual([
        "Jane's amount includes a $9,600/yr spousal top-up on John's work record, starting in 2037.",
      ]);
    });

    it("leaves the higher earner's row and the notes alone when no one draws a top-up", () => {
      const data = buildClientProfileData({ ...base, clientData: couple(2000) });
      expect(data.income.find((r) => r.name === "SS — John")).toMatchObject({ typeLabel: "Social Security", amount: 43200 });
      expect(data.income.find((r) => r.name === "SS — Jane")).toMatchObject({ typeLabel: "Social Security", amount: 24000 });
      expect(data.incomeNotes).toEqual([]);
    });
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

  it("anchors the Retirement column to the LAST Co-client to retire, not the first", () => {
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

  it("breaks Medicare premiums out of Insurance, right below it", () => {
    // The engine folds modeled Medicare premiums into `insurance` and keys them
    // `medicarePremiums` in bySource. Retirement-year insurance = $6,000 of
    // policies + $10,456.37 of Medicare.
    const medicareYears = [
      py({ year: 2026, expenses: { living: 52400, insurance: 6000, total: 58400 } }),
      py({ year: 2033, expenses: {
        living: 60000, insurance: 16456.37, total: 76456.37,
        bySource: { medicarePremiums: 10456.37 },
      } }),
    ];
    const data = buildClientProfileData({ ...base, years: medicareYears, clientData: clientData({}) });
    expect(data.expenses.map((r) => r.label)).toEqual(["Living", "Insurance", "Medicare", "Total"]);
    expect(data.expenses.find((r) => r.label === "Insurance")).toMatchObject({ current: 6000 });
    expect(data.expenses.find((r) => r.label === "Insurance")!.retirement).toBeCloseTo(6000, 6);
    expect(data.expenses.find((r) => r.label === "Medicare")).toMatchObject({ current: 0, retirement: 10456.37 });
    expect(data.expenses.find((r) => r.isTotal)).toMatchObject({ current: 58400, retirement: 76456.37 });
  });

  it("drops the Insurance row when Medicare is the only insurance cost", () => {
    // The engine's order: two pre-Medicare health policies are summed, both
    // pre-empted at enrollment, then Medicare is added. What is left of
    // insurance after removing Medicare is float dust, not a clean 0 — it must
    // not surface as a "$0" Insurance row.
    const medicare = 10358.38;
    const insurance = 9755.18 + 6472.19 - 9755.18 - 6472.19 + medicare;
    expect(insurance - medicare).not.toBe(0);
    const onlyMedicare = [
      py({ year: 2026, expenses: { living: 52400, total: 52400 } }),
      py({ year: 2033, expenses: {
        living: 60000, insurance, total: 60000 + medicare,
        bySource: { medicarePremiums: medicare },
      } }),
    ];
    const data = buildClientProfileData({ ...base, years: onlyMedicare, clientData: clientData({}) });
    expect(data.expenses.map((r) => r.label)).toEqual(["Living", "Medicare", "Total"]);
  });
});

describe("buildClientProfileData — mid-year retirement", () => {
  // Mirrors a real couple: the client retires in 2026, the spouse at 64 in 2027,
  // and the joint salary is anchored to the SPOUSE's retirement. `endYear`
  // resolves to 2026 (the last full year) while the engine keeps paying a
  // prorated slice through the retirement month of 2027.
  const spouseRetiresJuly = {
    dateOfBirth: "1962-01-15", retirementAge: 64, retirementMonth: 1,
    spouseName: "Carrie", spouseDob: "1963-11-21",
    spouseRetirementAge: 64, spouseRetirementMonth: 7,
  };
  const longPlan = [
    py({ year: 2026, ageClient: 64, bySource: { sal: 194000 } }),
    py({ year: 2027, ageClient: 65, bySource: { sal: 97000 } }),
    py({ year: 2040, ageClient: 78, bySource: {} }),
  ];
  const salary = {
    id: "sal", type: "salary", name: "Joint - Salary", annualAmount: 194000,
    startYear: 2020, endYear: 2026, owner: "joint", growthRate: 0,
    endYearRef: "spouse_retirement",
  };

  it("names the year the salary actually stops, not the last full year", () => {
    const data = buildClientProfileData({
      ...base,
      years: longPlan,
      clientData: clientData(spouseRetiresJuly, { incomes: [salary] as ClientData["incomes"] }),
    });
    // Retirement is July 2027, so the salary runs Jan–Jun 2027. The End column
    // must say 2027 — showing 2026 hid half a year of pay.
    expect(data.income.find((r) => r.name === "Joint - Salary")!.endYear).toBe(2027);
  });

  it("leaves a January retirement on the last full year", () => {
    const data = buildClientProfileData({
      ...base,
      years: longPlan,
      clientData: clientData(
        { ...spouseRetiresJuly, spouseRetirementMonth: 1 },
        { incomes: [salary] as ClientData["incomes"] },
      ),
    });
    // month=1 pays nothing in 2027, so 2026 really is the last year.
    expect(data.income.find((r) => r.name === "Joint - Salary")!.endYear).toBe(2026);
  });

  it("shows the entered annual amount for a row prorated by a mid-year start", () => {
    const data = buildClientProfileData({
      ...base,
      years: [
        py({ year: 2026, ageClient: 64, bySource: {} }),
        // Pension starts at a February retirement -> engine pays 11/12 in 2027.
        py({ year: 2027, ageClient: 65, bySource: { pen: 57750 } }),
        py({ year: 2040, ageClient: 78, bySource: {} }),
      ],
      clientData: clientData(spouseRetiresJuly, {
        incomes: [{
          id: "pen", type: "deferred", name: "Carrie - Deferred", annualAmount: 63000,
          startYear: 2027, endYear: 2060, owner: "spouse", growthRate: 0,
          startYearRef: "spouse_retirement",
        }] as ClientData["incomes"],
      }),
    });
    expect(data.income.find((r) => r.name === "Carrie - Deferred")!.amount).toBe(63000);
  });

  it("shows the entered amount rather than the grown projection value", () => {
    const data = buildClientProfileData({
      ...base,
      years: [
        py({ year: 2026, ageClient: 64, bySource: {} }),
        py({ year: 2030, ageClient: 68, bySource: { pen: 45000 } }),
        py({ year: 2040, ageClient: 78, bySource: {} }),
      ],
      clientData: clientData(spouseRetiresJuly, {
        incomes: [{
          id: "pen", type: "deferred", name: "Pension", annualAmount: 40000,
          startYear: 2030, endYear: 2060, owner: "client", growthRate: 0.03,
        }] as ClientData["incomes"],
      }),
    });
    expect(data.income.find((r) => r.name === "Pension")!.amount).toBe(40000);
  });
});
