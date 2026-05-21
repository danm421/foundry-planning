import { describe, it, expect } from "vitest";
import { applyBusinessSuccession } from "../business-succession";
import type { Account, EntitySummary, FamilyMember, Will } from "../../types";

const cooper: FamilyMember = { id: "fmCooper", role: "client", relationship: "other", firstName: "Cooper", lastName: "", dateOfBirth: "1960-01-01" } as FamilyMember;
const spouse: FamilyMember = { id: "fmSpouse", role: "spouse", relationship: "other", firstName: "Sam", lastName: "", dateOfBirth: "1962-01-01" } as FamilyMember;
const child: FamilyMember = { id: "fmChild", role: "child", relationship: "child", firstName: "Kid", lastName: "", dateOfBirth: "1990-01-01" } as FamilyMember;

function llc(owners: Array<{ familyMemberId: string; percent: number }>): EntitySummary {
  // Synthesize `kind: "family_member"` on each owner so the fixture matches the
  // discriminated EntityOwner shape that the engine's narrowing predicates expect.
  const taggedOwners = owners.map((o) => ({ kind: "family_member" as const, ...o }));
  return { id: "e1", name: "Test Bus", entityType: "llc", value: 10_000, basis: 4_000, owners: taggedOwners } as EntitySummary;
}
const accounts: Account[] = [];
const balances: Record<string, number> = {};

describe("applyBusinessSuccession", () => {
  it("first death, no will, spouse survives → routes to spouse, basis steps up", () => {
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, entities: [llc([{ familyMemberId: "fmCooper", percent: 1 }])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].sourceEntityId).toBe("e1");
    expect(r.transfers[0].recipientKind).toBe("spouse");
    expect(r.transfers[0].amount).toBe(10_000);
    expect(r.ownerUpdates[0]).toEqual({
      entityId: "e1", removeFamilyMemberId: "fmCooper",
      successors: [{ familyMemberId: "fmSpouse", percent: 1 }],
    });
    expect(r.basisUpdates[0]).toEqual({ entityId: "e1", newBasis: 10_000 });
  });

  it("no will, no spouse → routes to children fallback", () => {
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: null,
      deathOrder: 2, entities: [llc([{ familyMemberId: "fmCooper", percent: 1 }])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will: null, familyMembers: [cooper, child], externalBeneficiaries: [], year: 2040,
    });
    expect(r.transfers[0].recipientKind).toBe("family_member");
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmChild", percent: 1 }]);
  });

  it("60/40 client/spouse → only the 60% client share routes", () => {
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1,
      entities: [llc([
        { familyMemberId: "fmCooper", percent: 0.6 },
        { familyMemberId: "fmSpouse", percent: 0.4 },
      ])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers[0].amount).toBe(6_000); // 10k × 0.6
    // basis: 4000×(1−0.6) + 10000×0.6 = 1600 + 6000 = 7600
    expect(r.basisUpdates[0].newBasis).toBeCloseTo(7_600);
  });

  it("specific will bequest naming the entity beats fallback", () => {
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to child", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "e1", liabilityId: null, percentage: 100,
        condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fmChild", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, entities: [llc([{ familyMemberId: "fmCooper", percent: 1 }])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will, familyMembers: [cooper, spouse, child], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmChild", percent: 1 }]);
  });

  it("non-family recipient (charity) → rows removed, no successor", () => {
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to charity", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "e1", liabilityId: null, percentage: 100,
        condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "external_beneficiary", recipientId: "charity1", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, entities: [llc([{ familyMemberId: "fmCooper", percent: 1 }])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will, familyMembers: [cooper, spouse],
      externalBeneficiaries: [{ id: "charity1", name: "Charity", kind: "charity" }],
      year: 2030,
    });
    expect(r.transfers[0].recipientKind).toBe("external_beneficiary");
    expect(r.ownerUpdates[0]).toEqual({
      entityId: "e1", removeFamilyMemberId: "fmCooper", successors: [],
    });
  });

  it("legacy owners == null → joint convention", () => {
    const legacy = { id: "e1", name: "Old Co", entityType: "llc", value: 10_000, basis: 4_000 } as EntitySummary;
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, entities: [legacy],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers[0].amount).toBe(5_000); // 10k × 0.5 joint at first death
    expect(r.warnings).toContain("business_legacy_owners_joint: e1");
  });

  it("deathOrder 2, no survivor, no children → fallback_other_heirs / system_default, successors empty", () => {
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: null,
      deathOrder: 2, entities: [llc([{ familyMemberId: "fmCooper", percent: 1 }])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will: null, familyMembers: [cooper], externalBeneficiaries: [], year: 2045,
    });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].recipientKind).toBe("system_default");
    expect(r.transfers[0].via).toBe("fallback_other_heirs");
    expect(r.ownerUpdates[0].successors).toHaveLength(0);
  });

  it("zero consolidated value → no transfers, ownerUpdates, or basisUpdates", () => {
    const zeroEntity: EntitySummary = {
      id: "e1", name: "Empty Co", entityType: "llc", value: 0, basis: 0,
      owners: [{ familyMemberId: "fmCooper", percent: 1 }],
    } as EntitySummary;
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, entities: [zeroEntity],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers).toHaveLength(0);
    expect(r.ownerUpdates).toHaveLength(0);
    expect(r.basisUpdates).toHaveLength(0);
  });

  it("condition-gated bequest: if_spouse_predeceased at first death (spouse alive) → ignored, routes to spouse fallback", () => {
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to child if spouse predeceased", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "e1", liabilityId: null, percentage: 100,
        condition: "if_spouse_predeceased", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fmChild", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, entities: [llc([{ familyMemberId: "fmCooper", percent: 1 }])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will, familyMembers: [cooper, spouse, child], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers[0].recipientKind).toBe("spouse");
    expect(r.transfers[0].recipientId).toBe("fmSpouse");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmSpouse", percent: 1 }]);
  });

  it("condition-gated bequest: if_spouse_predeceased at final death (no survivor) → fires, routes to child", () => {
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to child if spouse predeceased", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "e1", liabilityId: null, percentage: 100,
        condition: "if_spouse_predeceased", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fmChild", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: null,
      deathOrder: 2, entities: [llc([{ familyMemberId: "fmCooper", percent: 1 }])],
      accounts, accountBalances: balances, entityAccountSharesEoY: undefined,
      will, familyMembers: [cooper, child], externalBeneficiaries: [], year: 2035,
    });
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmChild", percent: 1 }]);
  });
});
