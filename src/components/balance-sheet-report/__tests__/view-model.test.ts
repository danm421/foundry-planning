// src/components/balance-sheet-report/__tests__/view-model.test.ts
import { describe, it, expect } from "vitest";
import { buildViewModel, type BuildViewModelInput } from "../view-model";

const accounts = [
  { id: "a-cash", name: "Joint Checking", category: "cash", owner: "joint" as const, ownerEntityId: null },
  { id: "a-401k", name: "John 401k", category: "retirement", owner: "client" as const, ownerEntityId: null },
  { id: "a-roth", name: "Jane Roth", category: "retirement", owner: "spouse" as const, ownerEntityId: null },
  { id: "a-home", name: "Primary Home", category: "real_estate", owner: "joint" as const, ownerEntityId: null },
  { id: "a-trust", name: "Family Trust Brokerage", category: "taxable", owner: "client" as const, ownerEntityId: "trust-1" },
];

const liabilities = [
  { id: "l-mort", name: "Primary Mortgage", owner: "joint" as const, ownerEntityId: null, linkedPropertyId: "a-home" },
  { id: "l-card", name: "Credit Card", owner: "client" as const, ownerEntityId: null, linkedPropertyId: null },
];

const projectionYear = {
  year: 2026,
  portfolioAssets: {
    // NOTE: portfolioAssets is still engine-provided but no longer consulted
    // by the view-model. Kept here to satisfy the type. Values mirror the
    // accountLedgers below for sanity.
    cash: { "a-cash": 50_000 },
    taxable: {},
    retirement: { "a-401k": 500_000, "a-roth": 200_000 },
    realEstate: { "a-home": 800_000 },
    business: {},
    lifeInsurance: {},
    cashTotal: 50_000,
    taxableTotal: 0,
    retirementTotal: 700_000,
    realEstateTotal: 800_000,
    businessTotal: 0,
    lifeInsuranceTotal: 0,
    total: 1_550_000, // in-estate only — engine excludes entity-owned
  },
  liabilityBalancesBoY: { "l-mort": 400_000, "l-card": 8_000 },
  accountLedgers: {
    "a-cash": { beginningValue: 45_000, endingValue: 50_000 },
    "a-trust": { beginningValue: 275_000, endingValue: 300_000 },
    "a-401k": { beginningValue: 455_000, endingValue: 500_000 },
    "a-roth": { beginningValue: 180_000, endingValue: 200_000 },
    "a-home": { beginningValue: 745_000, endingValue: 800_000 },
  },
};

const priorYear = {
  year: 2025,
  portfolioAssets: {
    ...projectionYear.portfolioAssets,
    cash: { "a-cash": 45_000 },
    cashTotal: 45_000,
    retirement: { "a-401k": 455_000, "a-roth": 180_000 },
    retirementTotal: 635_000,
    realEstate: { "a-home": 745_000 },
    realEstateTotal: 745_000,
    total: 1_425_000,
  },
  liabilityBalancesBoY: { "l-mort": 410_000, "l-card": 10_000 },
  accountLedgers: {
    "a-cash": { beginningValue: 40_000, endingValue: 45_000 },
    "a-trust": { beginningValue: 250_000, endingValue: 275_000 },
    "a-401k": { beginningValue: 410_000, endingValue: 455_000 },
    "a-roth": { beginningValue: 165_000, endingValue: 180_000 },
    "a-home": { beginningValue: 700_000, endingValue: 745_000 },
  },
};

const baseInput: BuildViewModelInput = {
  accounts,
  liabilities,
  projectionYears: [priorYear, projectionYear],
  selectedYear: 2026,
  view: "consolidated",
};

describe("buildViewModel (consolidated)", () => {
  const vm = buildViewModel(baseInput);

  it("computes total assets across all categories including entity-owned", () => {
    expect(vm.totalAssets).toBe(1_850_000);
  });

  it("computes total liabilities across all owners", () => {
    expect(vm.totalLiabilities).toBe(408_000);
  });

  it("computes net worth = assets - liabilities", () => {
    expect(vm.netWorth).toBe(1_442_000);
  });

  it("returns categories in canonical order, zero-total categories excluded", () => {
    expect(vm.assetCategories.map((c) => c.key)).toEqual([
      "cash", "taxable", "retirement", "realEstate",
    ]);
  });

  it("includes an out-of-estate group with entity-owned accounts", () => {
    expect(vm.outOfEstateRows.map((r) => r.accountId)).toEqual(["a-trust"]);
    expect(vm.outOfEstateRows[0].value).toBe(300_000);
  });

  it("flags real estate rows that have a linked mortgage", () => {
    const re = vm.assetCategories.find((c) => c.key === "realEstate")!;
    const home = re.rows.find((r) => r.accountId === "a-home")!;
    expect(home.hasLinkedMortgage).toBe(true);
  });

  it("computes real estate equity = market value - linked mortgages", () => {
    expect(vm.realEstateEquity).toBe(400_000); // 800k home - 400k mortgage
  });

  it("computes YoY for total assets against the prior projection year", () => {
    expect(vm.yoy.totalAssets?.value).toBeCloseTo(((1_850_000 - 1_700_000) / 1_700_000) * 100, 2);
    expect(vm.yoy.totalAssets?.badge).toBe("up");
  });

  it("returns a donut slice per non-zero category with correct totals", () => {
    expect(vm.donut).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "cash", value: 50_000 }),
        expect.objectContaining({ key: "taxable", value: 300_000 }),
        expect.objectContaining({ key: "retirement", value: 700_000 }),
        expect.objectContaining({ key: "realEstate", value: 800_000 }),
      ]),
    );
    expect(vm.donut).toHaveLength(4);
  });
});

describe("buildViewModel (filtered views)", () => {
  it("client-only excludes entity-owned and other owners", () => {
    const vm = buildViewModel({ ...baseInput, view: "client" });
    expect(vm.outOfEstateRows).toEqual([]);
    const allRowAccountIds = vm.assetCategories.flatMap((c) => c.rows.map((r) => r.accountId));
    expect(allRowAccountIds).toEqual(["a-401k"]);
    expect(vm.totalAssets).toBe(500_000);
  });

  it("entities-only includes only entity-owned rows", () => {
    const vm = buildViewModel({ ...baseInput, view: "entities" });
    const allRowAccountIds = vm.assetCategories.flatMap((c) => c.rows.map((r) => r.accountId));
    expect(allRowAccountIds).toEqual(["a-trust"]);
    expect(vm.totalAssets).toBe(300_000);
    expect(vm.outOfEstateRows).toEqual([]); // entities view has no separate group
  });

  it("joint view includes the joint mortgage in liabilities", () => {
    const vm = buildViewModel({ ...baseInput, view: "joint" });
    expect(vm.liabilityRows.map((r) => r.liabilityId)).toEqual(["l-mort"]);
    expect(vm.totalLiabilities).toBe(400_000);
  });
});

describe("buildViewModel (edge cases)", () => {
  it("yoy is null for the first projection year", () => {
    const vm = buildViewModel({ ...baseInput, projectionYears: [projectionYear], selectedYear: 2026 });
    expect(vm.yoy.totalAssets).toBeNull();
    expect(vm.yoy.totalLiabilities).toBeNull();
    expect(vm.yoy.netWorth).toBeNull();
  });

  it("barChartSeries contains up to 5 entries centered on selected year", () => {
    const vm = buildViewModel(baseInput);
    expect(vm.barChartSeries.map((p) => p.year)).toEqual([2025, 2026]);
  });

  it("returns empty liabilityRows when client has no liabilities", () => {
    const vm = buildViewModel({ ...baseInput, liabilities: [], projectionYears: [priorYear, { ...projectionYear, liabilityBalancesBoY: {} }] });
    expect(vm.liabilityRows).toEqual([]);
    expect(vm.totalLiabilities).toBe(0);
  });
});
