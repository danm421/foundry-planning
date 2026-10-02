// The Family page's loader lists people, charities and beneficiary designations
// from the SCENARIO's effective tree: a member or charity a scenario added
// shows, an edited one shows its edit, and the base tables are read only for
// what the tree doesn't carry (notes). Mocked at the DB / loader boundary —
// which tree reaches the view is what's under test, not any WHERE.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";
const SCENARIO_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_FM = "44444444-4444-4444-8444-444444444444";
const SPOUSE_FM = "55555555-5555-4555-8555-555555555555";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");
const tableName = (t: unknown): string => (t as Record<symbol, string> | null)?.[DRIZZLE_NAME] ?? "";

let rowsByTable: Record<string, unknown[]> = {};

vi.mock("@/db", () => {
  const chain = (rows: unknown[]) => {
    const node = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    node.where = () => node;
    node.orderBy = () => node;
    node.innerJoin = () => node;
    return node;
  };
  return { db: { select: () => ({ from: (table: unknown) => chain(rowsByTable[tableName(table)] ?? []) }) } };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
vi.mock("@/lib/db-helpers", () => ({ getOrgId: vi.fn(async () => FIRM_ID) }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/scenario/changes", () => ({ loadActiveGiftChanges: vi.fn(async () => []) }));
vi.mock("@/lib/clients/get-client-with-contacts", () => ({ getClientWithContacts: vi.fn(async () => null) }));

import { loadFamilyViewProps } from "../load-view-props";
import { loadEffectiveTree } from "@/lib/scenario/loader";

const member = (over: Record<string, unknown>) => ({
  id: "fm", role: "child", relationship: "child", firstName: "Kid", lastName: null,
  dateOfBirth: "2015-01-01", domesticPartner: false, inheritanceClassOverride: {},
  claimedAsDependent: "auto", ...over,
});

function tree(over: Record<string, unknown> = {}) {
  return {
    client: {
      firstName: "Cooper", lastName: "C", spouseName: "Jane", dateOfBirth: "1970-01-01", lifeExpectancy: 95,
      spouseDob: "1972-01-01", spouseLifeExpectancy: 95, retirementAge: 65, planEndAge: 95,
      spouseRetirementAge: 65, filingStatus: "married_joint",
    },
    accounts: [],
    liabilities: [],
    incomes: [],
    expenses: [],
    planSettings: { planStartYear: 2026, planEndYear: 2061, inflationRate: 0.025 },
    familyMembers: [
      member({ id: CLIENT_FM, role: "client", firstName: "Cooper", lastName: "C", relationship: "other" }),
      member({ id: SPOUSE_FM, role: "spouse", firstName: "Jane", lastName: "C", relationship: "other" }),
    ],
    entities: [],
    externalBeneficiaries: [],
    ...over,
  };
}

function mountTree(t: ReturnType<typeof tree>) {
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: t,
    warnings: [],
    resolutionContext: {},
  } as never);
}

beforeEach(() => {
  rowsByTable = {
    clients: [{ id: CLIENT_ID, firmId: FIRM_ID, crmHouseholdId: "h-1" }],
    scenarios: [{ id: SCENARIO_ID, name: "Base", isBaseCase: false }],
    family_members: [],
    external_beneficiaries: [],
  };
  vi.mocked(loadEffectiveTree).mockReset();
});

describe("loadFamilyViewProps — members and charities", () => {
  it("lists a member the scenario added, though no base row exists for it", async () => {
    mountTree(tree({ familyMembers: [...tree().familyMembers, member({ id: "scn-kid", firstName: "Zed", notes: "added here" })] }));
    const { props } = await loadFamilyViewProps(CLIENT_ID, SCENARIO_ID);
    expect(props.initialMembers.map((m) => m.id)).toEqual(["scn-kid"]);
    expect(props.initialMembers[0]).toMatchObject({ firstName: "Zed", role: "child", notes: "added here" });
    // The asset-owner picker still lists the principals.
    expect(props.initialAssetFamilyMembers?.map((m) => m.id)).toEqual([CLIENT_FM, SPOUSE_FM, "scn-kid"]);
  });

  it("shows the scenario's edit, and keeps the base row's notes when the tree carries none", async () => {
    rowsByTable.family_members = [{ id: "fm-1", notes: "base note" }];
    mountTree(tree({ familyMembers: [...tree().familyMembers, member({ id: "fm-1", firstName: "Edited" })] }));
    const { props } = await loadFamilyViewProps(CLIENT_ID, SCENARIO_ID);
    expect(props.initialMembers[0]).toMatchObject({ id: "fm-1", firstName: "Edited", notes: "base note" });
  });

  it("defaults a missing role and dependent flag, and sorts by relationship then first name", async () => {
    mountTree(
      tree({
        familyMembers: [
          ...tree().familyMembers,
          member({ id: "b", relationship: "sibling", firstName: "Bea", role: undefined, claimedAsDependent: undefined }),
          member({ id: "a", relationship: "child", firstName: "Zed" }),
          member({ id: "c", relationship: "child", firstName: "Amy" }),
        ],
      }),
    );
    const { props } = await loadFamilyViewProps(CLIENT_ID, SCENARIO_ID);
    expect(props.initialMembers.map((m) => m.id)).toEqual(["c", "a", "b"]);
    expect(props.initialMembers[2]).toMatchObject({ role: "other", claimedAsDependent: "auto" });
  });

  it("lists a charity the scenario added, with the base row's notes when the tree has none", async () => {
    rowsByTable.external_beneficiaries = [{ id: "ext-1", notes: "base charity note" }];
    mountTree(
      tree({
        externalBeneficiaries: [
          { id: "ext-1", name: "Red Cross", kind: "charity", charityType: "public" },
          { id: "scn-ext", name: "Library", kind: "charity", charityType: "public", notes: "new" },
        ],
      }),
    );
    const { props } = await loadFamilyViewProps(CLIENT_ID, SCENARIO_ID);
    expect(props.initialExternalBeneficiaries).toEqual([
      { id: "scn-ext", name: "Library", kind: "charity", notes: "new" },
      { id: "ext-1", name: "Red Cross", kind: "charity", notes: "base charity note" },
    ]);
  });

  it("drops a member the scenario removed", async () => {
    rowsByTable.family_members = [{ id: "fm-gone", notes: null }];
    mountTree(tree());
    const { props } = await loadFamilyViewProps(CLIENT_ID, SCENARIO_ID);
    expect(props.initialMembers).toEqual([]);
  });
});

describe("loadFamilyViewProps — designations", () => {
  it("lists the scenario's account and trust designations, not the base table's", async () => {
    mountTree(
      tree({
        accounts: [
          {
            id: "acct-1", name: "Brokerage", category: "taxable", value: 1, subType: "brokerage",
            owners: [], beneficiaries: [{ id: "d1", tier: "primary", percentage: 100, familyMemberId: "scn-kid", sortOrder: 0 }],
          },
        ],
        entities: [
          {
            id: "ent-1", name: "ILIT", entityType: "trust", includeInPortfolio: false, isGrantor: false,
            beneficiaries: [{ id: "d2", tier: "contingent", percentage: 50, externalBeneficiaryId: "ext-1", sortOrder: 1 }],
            remainderBeneficiaries: [{ familyMemberId: "scn-kid", percentage: 100, distributionForm: "in_trust" }],
          },
        ],
      }),
    );
    const { props } = await loadFamilyViewProps(CLIENT_ID, SCENARIO_ID);
    expect(props.initialDesignations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "d1", targetKind: "account", accountId: "acct-1", tier: "primary", familyMemberId: "scn-kid", percentage: 100 }),
        expect.objectContaining({ id: "d2", targetKind: "trust", entityId: "ent-1", tier: "contingent", externalBeneficiaryId: "ext-1", percentage: 50 }),
        expect.objectContaining({ targetKind: "trust", entityId: "ent-1", tier: "remainder", familyMemberId: "scn-kid", distributionForm: "in_trust" }),
      ]),
    );
    expect(props.initialDesignations).toHaveLength(3);
  });
});
