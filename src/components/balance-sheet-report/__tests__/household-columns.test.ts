// src/components/balance-sheet-report/__tests__/household-columns.test.ts
import { describe, it, expect } from "vitest";
import type { FamilyMember } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import { buildHouseholdColumns, type BuildHouseholdColumnsInput } from "../household-columns";

const FM_CLIENT = "c";
const FM_SPOUSE = "s";
const familyMembers: FamilyMember[] = [
  { id: FM_CLIENT, role: "client", relationship: "child", firstName: "John", lastName: null, dateOfBirth: null },
  { id: FM_SPOUSE, role: "spouse", relationship: "child", firstName: "Jane", lastName: null, dateOfBirth: null },
];
const half: AccountOwner[] = [
  { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
  { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
];
const clientOnly: AccountOwner[] = [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }];
const trustOnly: AccountOwner[] = [{ kind: "entity", entityId: "t1", percent: 1 }];

const base: BuildHouseholdColumnsInput = {
  accounts: [
    { id: "a-cash", name: "Joint Checking", category: "cash", titlingType: "jtwros", owners: half },
    { id: "a-401k", name: "John 401k", category: "retirement", owners: clientOnly },
    { id: "a-home", name: "Home", category: "real_estate", owners: half },
    { id: "a-trust", name: "Trust Brokerage", category: "taxable", owners: trustOnly },
  ],
  liabilities: [
    { id: "l-mort", name: "Mortgage", owners: half, linkedPropertyId: "a-home" },
    { id: "l-card", name: "Card", owners: clientOnly, linkedPropertyId: null },
  ],
  entities: [{ id: "t1", name: "Family IDGT", entityType: "trust", isIrrevocable: true }],
  notesReceivable: [{ id: "n1", name: "Installment Note", owners: clientOnly }],
  familyMembers,
  projectionYears: [
    {
      year: 2026,
      accountLedgers: {
        "a-cash": { beginningValue: 0, endingValue: 100_000 },
        "a-401k": { beginningValue: 0, endingValue: 500_000 },
        "a-home": { beginningValue: 0, endingValue: 800_000 },
        "a-trust": { beginningValue: 0, endingValue: 300_000 },
      },
      liabilityBalancesBoY: { "l-mort": 400_000, "l-card": 8_000 },
      notesReceivableByNote: { n1: { endingBalance: 50_000 } },
    },
  ],
  selectedYear: 2026,
};

describe("buildHouseholdColumns", () => {
  const m = buildHouseholdColumns(base);

  it("routes a jtwros client+spouse 50/50 account entirely to the Joint column", () => {
    const cash = m.assetCategories.find((c) => c.key === "cash")!;
    const row = cash.rows.find((r) => r.key === "a-cash")!;
    expect(row).toMatchObject({ client: 0, spouse: 0, joint: 100_000, total: 100_000 });
  });

  it("routes a client-only account to the client column", () => {
    const ret = m.assetCategories.find((c) => c.key === "retirement")!;
    expect(ret.rows[0]).toMatchObject({ client: 500_000, spouse: 0, joint: 0, total: 500_000 });
  });

  it("excludes irrevocable-trust-owned accounts from the household table", () => {
    expect(m.assetCategories.find((c) => c.key === "taxable")).toBeUndefined();
  });

  it("includes Notes Receivable as a category from notesReceivableByNote", () => {
    const nr = m.assetCategories.find((c) => c.key === "notesReceivable")!;
    expect(nr.rows[0]).toMatchObject({ name: "Installment Note", client: 50_000, total: 50_000 });
  });

  it("flags real-estate rows with a linked mortgage", () => {
    const re = m.assetCategories.find((c) => c.key === "realEstate")!;
    expect(re.rows[0].hasLinkedMortgage).toBe(true);
  });

  it("totals assets across in-estate columns only (excludes trust)", () => {
    // cash 100k + 401k 500k + home 800k + note 50k = 1,450,000
    expect(m.totalAssets.total).toBe(1_450_000);
  });

  it("splits liabilities into columns and totals them", () => {
    // l-mort owners=half but liabilities have no titling -> client/spouse split
    // l-mort: client 200k + spouse 200k; l-card client 8k => client 208k, spouse 200k
    expect(m.totalLiabilities).toMatchObject({ client: 208_000, spouse: 200_000, joint: 0, total: 408_000 });
  });

  it("computes net worth columns = assets - liabilities", () => {
    expect(m.netWorth.total).toBe(1_450_000 - 408_000);
  });

  it("reports hasSpouse", () => {
    expect(m.hasSpouse).toBe(true);
    const single = buildHouseholdColumns({ ...base, familyMembers: [familyMembers[0]] });
    expect(single.hasSpouse).toBe(false);
  });

  it("throws when selectedYear is not in projectionYears", () => {
    expect(() => buildHouseholdColumns({ ...base, selectedYear: 9999 })).toThrow("9999");
  });

  it("includes a family-owned flat-valued business as one Business row", () => {
    const withBiz = buildHouseholdColumns({
      ...base,
      entities: [
        ...base.entities,
        { id: "llc1", name: "Smith LLC", entityType: "llc", value: 1_000_000, valueGrowthRate: 0, owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }] },
      ],
    });
    const biz = withBiz.assetCategories.find((c) => c.key === "business")!;
    expect(biz.rows.find((r) => r.name === "Smith LLC")).toMatchObject({ client: 1_000_000, total: 1_000_000 });
  });

  it("includes an ownerless (household-owned) account in the client column", () => {
    // Plaid "Add as new" accounts are inserted without an account_owners row.
    // They must still surface on the balance sheet, attributed to the client.
    const withOwnerless = buildHouseholdColumns({
      ...base,
      accounts: [
        ...base.accounts,
        { id: "a-plaid", name: "Plaid Money Market", category: "cash", owners: [] },
      ],
      projectionYears: [
        {
          ...base.projectionYears[0],
          accountLedgers: {
            ...base.projectionYears[0].accountLedgers,
            "a-plaid": { beginningValue: 0, endingValue: 43_200 },
          },
        },
      ],
    });
    const cash = withOwnerless.assetCategories.find((c) => c.key === "cash")!;
    const row = cash.rows.find((r) => r.key === "a-plaid")!;
    expect(row).toMatchObject({ client: 43_200, spouse: 0, joint: 0, total: 43_200 });
  });

  it("excludes a business owned entirely by an entity from the household table", () => {
    const trustOwnedBiz = buildHouseholdColumns({
      ...base,
      entities: [
        ...base.entities,
        { id: "llc-t", name: "Trust-Owned LLC", entityType: "llc", value: 1_000_000, valueGrowthRate: 0, owners: [{ kind: "entity", entityId: "t1", percent: 1 }] },
      ],
    });
    expect(trustOwnedBiz.assetCategories.find((c) => c.key === "business")).toBeUndefined();
  });
});
