// src/components/balance-sheet-report/__tests__/view-model.test.ts
import { describe, it, expect } from "vitest";
import type { FamilyMember } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import { buildViewModel, type BuildViewModelInput } from "../view-model";

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";

const familyMembers: FamilyMember[] = [
  { id: FM_CLIENT, role: "client", relationship: "child", firstName: "John", lastName: null, dateOfBirth: null },
  { id: FM_SPOUSE, role: "spouse", relationship: "child", firstName: "Jane", lastName: null, dateOfBirth: null },
];

const half: AccountOwner[] = [
  { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
  { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
];
const clientOnly: AccountOwner[] = [
  { kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 },
];
const spouseOnly: AccountOwner[] = [
  { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 1 },
];
const trustOnly: AccountOwner[] = [
  { kind: "entity", entityId: "trust-1", percent: 1 },
];

const accounts = [
  { id: "a-cash", name: "Joint Checking", category: "cash", owners: half },
  { id: "a-401k", name: "John 401k", category: "retirement", owners: clientOnly },
  { id: "a-roth", name: "Jane Roth", category: "retirement", owners: spouseOnly },
  { id: "a-home", name: "Primary Home", category: "real_estate", owners: half },
  { id: "a-trust", name: "Family Trust Brokerage", category: "taxable", owners: trustOnly },
];

const liabilities = [
  { id: "l-mort", name: "Primary Mortgage", owners: half, linkedPropertyId: "a-home" },
  { id: "l-card", name: "Credit Card", owners: clientOnly, linkedPropertyId: null },
];

// Trust is irrevocable → out-of-estate. (The old binary classification
// always sent ownerEntityId !== null to OOE; under the slice model the
// irrevocable flag is what drives the routing.)
const entities = [
  { id: "trust-1", name: "Smith Family IDGT", entityType: "trust", isIrrevocable: true },
];

const projectionYear = {
  year: 2026,
  portfolioAssets: {
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
    total: 1_550_000,
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
  entities,
  familyMembers,
  projectionYears: [priorYear, projectionYear],
  selectedYear: 2026,
  view: "consolidated",
};

describe("buildViewModel (consolidated)", () => {
  const vm = buildViewModel(baseInput);

  it("computes total assets from in-estate slices only", () => {
    // 50k cash + 500k 401k + 200k roth + 800k home = 1,550,000.
    // The irrevocable trust brokerage routes to OOE.
    expect(vm.totalAssets).toBe(1_550_000);
  });

  it("computes total liabilities from in-estate slices only", () => {
    expect(vm.totalLiabilities).toBe(408_000);
  });

  it("computes net worth = in-estate assets - in-estate liabilities", () => {
    expect(vm.netWorth).toBe(1_142_000);
  });

  it("includes a category for every category with at least one in-estate slice", () => {
    expect(vm.assetCategories.map((c) => c.key)).toEqual([
      "cash",
      "retirement",
      "realEstate",
    ]);
  });

  it("expands joint accounts into per-family-member slices", () => {
    const cash = vm.assetCategories.find((c) => c.key === "cash")!;
    expect(cash.rows.length).toBe(2); // two slices for the joint cash account
    const labels = cash.rows.map((r) => r.ownerLabel).sort();
    expect(labels).toEqual(["Jane", "John"]);
    expect(cash.rows.every((r) => r.value === 25_000)).toBe(true);
  });

  it("surfaces irrevocable-trust slices in outOfEstateRows", () => {
    expect(vm.outOfEstateRows.map((r) => r.accountId)).toEqual(["a-trust"]);
    expect(vm.outOfEstateRows[0].value).toBe(300_000);
  });

  it("flags real estate rows that have a linked mortgage", () => {
    const re = vm.assetCategories.find((c) => c.key === "realEstate")!;
    expect(re.rows.every((r) => r.hasLinkedMortgage)).toBe(true);
  });

  it("computes real estate equity from in-estate real estate only", () => {
    expect(vm.realEstateEquity).toBe(400_000); // 800k home - 400k mortgage
  });
});

describe("buildViewModel (business entity in estate)", () => {
  const businessEntities = [
    {
      id: "llc-1",
      name: "Smith Family LLC",
      entityType: "llc",
      value: 2_000_000,
      owners: [
        { familyMemberId: FM_CLIENT, percent: 0.5 },
        { familyMemberId: FM_SPOUSE, percent: 0.5 },
      ],
    },
  ];

  it("flat business value flows into the in-estate Business category", () => {
    const vm = buildViewModel({
      ...baseInput,
      entities: [...entities, ...businessEntities],
    });
    const biz = vm.assetCategories.find((c) => c.key === "business");
    expect(biz?.total).toBe(2_000_000);
    expect(biz?.rows[0].isFlatBusinessValue).toBe(true);
    expect(biz?.rows[0].ownerLabel).toBe("Smith Family LLC");
  });

  it("partially family-owned business splits the flat value across in-estate and OOE", () => {
    const partial = [{ ...businessEntities[0], owners: [{ familyMemberId: FM_CLIENT, percent: 0.6 }] }];
    const vm = buildViewModel({ ...baseInput, entities: [...entities, ...partial] });
    const biz = vm.assetCategories.find((c) => c.key === "business");
    expect(biz?.total).toBe(1_200_000); // 60% of 2M
    expect(vm.outOfEstateRows.find((r) => r.accountId === "llc-1")?.value).toBe(800_000);
  });

  it("an account owned by a family-owned LLC routes to in-estate under its category", () => {
    const llcAccount = {
      id: "a-llc-broker",
      name: "LLC Brokerage",
      category: "taxable",
      owners: [{ kind: "entity" as const, entityId: "llc-1", percent: 1 }],
    };
    const inputWithLLC: BuildViewModelInput = {
      ...baseInput,
      accounts: [...accounts, llcAccount],
      entities: [...entities, ...businessEntities],
      projectionYears: [
        priorYear,
        {
          ...projectionYear,
          accountLedgers: {
            ...projectionYear.accountLedgers,
            "a-llc-broker": { beginningValue: 0, endingValue: 500_000 },
          },
        },
      ],
    };
    const vm = buildViewModel(inputWithLLC);
    const taxable = vm.assetCategories.find((c) => c.key === "taxable");
    expect(taxable?.rows.find((r) => r.accountId === "a-llc-broker")?.value).toBe(500_000);
    expect(taxable?.rows.find((r) => r.accountId === "a-llc-broker")?.ownerLabel).toBe("Smith Family LLC");
    expect(vm.outOfEstateRows.find((r) => r.accountId === "a-llc-broker")).toBeUndefined();
  });
});

describe("buildViewModel (proportional ownership)", () => {
  it("an 80/20 client/LLC split produces two slices on one account", () => {
    const splitAccount = {
      id: "a-mix",
      name: "Mixed Account",
      category: "taxable",
      owners: [
        { kind: "family_member" as const, familyMemberId: FM_CLIENT, percent: 0.8 },
        { kind: "entity" as const, entityId: "llc-1", percent: 0.2 },
      ],
    };
    const vm = buildViewModel({
      ...baseInput,
      accounts: [splitAccount],
      entities: [
        { id: "llc-1", name: "Smith Family LLC", entityType: "llc", value: 0, owners: [{ familyMemberId: FM_CLIENT, percent: 1 }] },
      ],
      projectionYears: [
        { ...priorYear, accountLedgers: { "a-mix": { beginningValue: 90_000, endingValue: 100_000 } }, liabilityBalancesBoY: {} },
        { ...projectionYear, accountLedgers: { "a-mix": { beginningValue: 90_000, endingValue: 100_000 } }, liabilityBalancesBoY: {} },
      ],
      liabilities: [],
    });
    const taxable = vm.assetCategories.find((c) => c.key === "taxable")!;
    expect(taxable.rows).toHaveLength(2);
    const client = taxable.rows.find((r) => r.owner === "client")!;
    const entity = taxable.rows.find((r) => r.ownerEntityId === "llc-1")!;
    expect(client.value).toBe(80_000);
    expect(client.ownerPercent).toBe(0.8);
    expect(entity.value).toBe(20_000);
    expect(entity.ownerPercent).toBe(0.2);
  });
});

describe("buildViewModel (entities view)", () => {
  it("populates entity groups with slices owned by each entity", () => {
    const vm = buildViewModel({ ...baseInput, view: "entities" });
    expect(vm.entityGroups).toHaveLength(1);
    const g = vm.entityGroups![0];
    expect(g.entityId).toBe("trust-1");
    expect(g.assetRows.map((r) => r.accountId)).toEqual(["a-trust"]);
    expect(g.assetTotal).toBe(300_000);
    expect(g.netWorth).toBe(300_000);
  });

  it("includes the entity's flat business value as an asset row", () => {
    const vm = buildViewModel({
      ...baseInput,
      entities: [
        ...entities,
        {
          id: "llc-1",
          name: "Smith Family LLC",
          entityType: "llc",
          value: 1_000_000,
          owners: [{ familyMemberId: FM_CLIENT, percent: 1 }],
        },
      ],
      view: "entities",
    });
    const llc = vm.entityGroups?.find((g) => g.entityId === "llc-1");
    expect(llc).toBeDefined();
    expect(llc?.assetTotal).toBe(1_000_000);
    expect(llc?.assetRows[0].isFlatBusinessValue).toBe(true);
  });

  it("entityGroups is undefined when view !== entities", () => {
    const vm = buildViewModel({ ...baseInput, view: "consolidated" });
    expect(vm.entityGroups).toBeUndefined();
  });

  it("omits entities with no slices and no flat value", () => {
    const vm = buildViewModel({
      ...baseInput,
      entities: [...entities, { id: "ghost", name: "Ghost LLC", entityType: "llc" }],
      view: "entities",
    });
    expect(vm.entityGroups?.map((g) => g.entityId)).toEqual(["trust-1"]);
  });
});

describe("buildViewModel (personal views)", () => {
  it("client view includes only the client's family-member slices", () => {
    const vm = buildViewModel({ ...baseInput, view: "client" });
    const all = vm.assetCategories.flatMap((c) => c.rows);
    // Client slices: half of cash (25k), all of 401k (500k), half of home (400k)
    expect(all.map((r) => r.accountId).sort()).toEqual(["a-401k", "a-cash", "a-home"]);
    expect(vm.totalAssets).toBe(925_000);
  });

  it("spouse view includes only the spouse's family-member slices", () => {
    const vm = buildViewModel({ ...baseInput, view: "spouse" });
    const all = vm.assetCategories.flatMap((c) => c.rows);
    expect(all.map((r) => r.accountId).sort()).toEqual(["a-cash", "a-home", "a-roth"]);
    // 25k cash + 200k roth + 400k home = 625k
    expect(vm.totalAssets).toBe(625_000);
  });
});

describe("buildViewModel (edge cases)", () => {
  it("yoy is null for the first projection year", () => {
    const vm = buildViewModel({ ...baseInput, projectionYears: [projectionYear], selectedYear: 2026 });
    expect(vm.yoy.totalAssets).toBeNull();
    expect(vm.yoy.totalLiabilities).toBeNull();
    expect(vm.yoy.netWorth).toBeNull();
  });

  it("returns empty liabilityRows when client has no liabilities", () => {
    const vm = buildViewModel({
      ...baseInput,
      liabilities: [],
      projectionYears: [priorYear, { ...projectionYear, liabilityBalancesBoY: {} }],
    });
    expect(vm.liabilityRows).toEqual([]);
    expect(vm.totalLiabilities).toBe(0);
  });
});
