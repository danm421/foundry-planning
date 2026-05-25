import { describe, it, expect } from "vitest";
import { applyBusinessSuccession } from "../business-succession";
import type { Account, FamilyMember, Will } from "../../types";

const cooper: FamilyMember = { id: "fmCooper", role: "client", relationship: "other", firstName: "Cooper", lastName: "", dateOfBirth: "1960-01-01" } as FamilyMember;
const spouse: FamilyMember = { id: "fmSpouse", role: "spouse", relationship: "other", firstName: "Sam", lastName: "", dateOfBirth: "1962-01-01" } as FamilyMember;
const child: FamilyMember = { id: "fmChild", role: "child", relationship: "child", firstName: "Kid", lastName: "", dateOfBirth: "1990-01-01" } as FamilyMember;

/** Build a top-level business account with the given family-member ownership.
 *  Default value $10k flat / $4k basis (matches the legacy entity fixture). */
function llcAccount(owners: Array<{ familyMemberId: string; percent: number }>): Account {
  const taggedOwners = owners.map((o) => ({
    kind: "family_member" as const,
    familyMemberId: o.familyMemberId,
    percent: o.percent,
  }));
  return {
    id: "biz-1",
    name: "Test Bus",
    category: "business",
    subType: "llc",
    value: 10_000,
    basis: 4_000,
    businessType: "llc",
    parentAccountId: null,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: taggedOwners,
  } as Account;
}

/** balances Record keyed on the business account so businessConsolidatedValue sees its flat value. */
const balances = { "biz-1": 10_000 };

describe("applyBusinessSuccession", () => {
  it("first death, no will, spouse survives → routes to spouse, basis steps up", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, accounts: [biz], accountBalances: balances,
      will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].sourceAccountId).toBe("biz-1");
    expect(r.transfers[0].recipientKind).toBe("spouse");
    expect(r.transfers[0].amount).toBe(10_000);
    expect(r.ownerUpdates[0]).toEqual({
      accountId: "biz-1", removeFamilyMemberId: "fmCooper",
      successors: [{ familyMemberId: "fmSpouse", percent: 1 }],
    });
    expect(r.basisUpdates[0]).toEqual({ accountId: "biz-1", newBasis: 10_000 });
  });

  it("no will, no spouse → routes to children fallback", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: null,
      deathOrder: 2, accounts: [biz], accountBalances: balances,
      will: null, familyMembers: [cooper, child], externalBeneficiaries: [], year: 2040,
    });
    expect(r.transfers[0].recipientKind).toBe("family_member");
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmChild", percent: 1 }]);
  });

  it("60/40 client/spouse → only the 60% client share routes", () => {
    const biz = llcAccount([
      { familyMemberId: "fmCooper", percent: 0.6 },
      { familyMemberId: "fmSpouse", percent: 0.4 },
    ]);
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1,
      accounts: [biz], accountBalances: balances,
      will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers[0].amount).toBe(6_000); // 10k × 0.6
    // basis: 4000×(1−0.6) + 10000×0.6 = 1600 + 6000 = 7600
    expect(r.basisUpdates[0].newBasis).toBeCloseTo(7_600);
  });

  it("specific will bequest naming the business beats fallback", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to child", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "biz-1", liabilityId: null, percentage: 100,
        condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fmChild", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, accounts: [biz], accountBalances: balances,
      will, familyMembers: [cooper, spouse, child], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmChild", percent: 1 }]);
  });

  it("non-family recipient (charity) → rows removed, no successor", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to charity", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "biz-1", liabilityId: null, percentage: 100,
        condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "external_beneficiary", recipientId: "charity1", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, accounts: [biz], accountBalances: balances,
      will, familyMembers: [cooper, spouse],
      externalBeneficiaries: [{ id: "charity1", name: "Charity", kind: "charity" }],
      year: 2030,
    });
    expect(r.transfers[0].recipientKind).toBe("external_beneficiary");
    expect(r.ownerUpdates[0]).toEqual({
      accountId: "biz-1", removeFamilyMemberId: "fmCooper", successors: [],
    });
  });

  it("zero consolidated value → no transfers, ownerUpdates, or basisUpdates", () => {
    const zeroBiz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    zeroBiz.value = 0;
    zeroBiz.basis = 0;
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, accounts: [zeroBiz], accountBalances: { "biz-1": 0 },
      will: null, familyMembers: [cooper, spouse], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers).toHaveLength(0);
    expect(r.ownerUpdates).toHaveLength(0);
    expect(r.basisUpdates).toHaveLength(0);
  });

  it("deathOrder 2, no survivor, no children → fallback_other_heirs / system_default, successors empty", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: null,
      deathOrder: 2, accounts: [biz], accountBalances: balances,
      will: null, familyMembers: [cooper], externalBeneficiaries: [], year: 2045,
    });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].recipientKind).toBe("system_default");
    expect(r.transfers[0].via).toBe("fallback_other_heirs");
    expect(r.ownerUpdates[0].successors).toHaveLength(0);
  });

  it("married final death uses the residuary contingent tier (not primary)", () => {
    // Susan-dies-second scenario: Susan's will has primary=spouse, contingent=child.
    // Without the contingent-tier fix the engine incorrectly used primary (spouse,
    // who is dead), recorded the transfer with recipientId=null, and the display
    // layer fell back to role==spouse → labeling the recipient as Susan herself.
    const biz = llcAccount([{ familyMemberId: "fmSpouse", percent: 1 }]);
    const will: Will = {
      id: "w-susan", grantor: "spouse", bequests: [],
      residuaryRecipients: [
        { recipientKind: "spouse", recipientId: null, tier: "primary", percentage: 100, sortOrder: 0 },
        { recipientKind: "family_member", recipientId: "fmChild", tier: "contingent", percentage: 100, sortOrder: 1 },
      ],
    } as Will;
    const r = applyBusinessSuccession({
      deceased: "spouse", deceasedFmId: "fmSpouse", survivorFmId: null,
      deathOrder: 2, accounts: [biz], accountBalances: balances,
      will, familyMembers: [cooper, spouse, child], externalBeneficiaries: [], year: 2045,
    });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].recipientKind).toBe("family_member");
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(r.transfers[0].via).toBe("will_residuary");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmChild", percent: 1 }]);
  });

  it("married final death with only a primary-spouse residuary → lapses, falls through to children", () => {
    // Same scenario but the contingent tier was never filled in. The primary
    // tier's lone spouse recipient lapses (no survivor), so the residuary as a
    // whole is empty for this death and we fall through to the children fallback.
    const biz = llcAccount([{ familyMemberId: "fmSpouse", percent: 1 }]);
    const will: Will = {
      id: "w-susan", grantor: "spouse", bequests: [],
      residuaryRecipients: [
        { recipientKind: "spouse", recipientId: null, tier: "primary", percentage: 100, sortOrder: 0 },
      ],
    } as Will;
    const r = applyBusinessSuccession({
      deceased: "spouse", deceasedFmId: "fmSpouse", survivorFmId: null,
      deathOrder: 2, accounts: [biz], accountBalances: balances,
      will, familyMembers: [cooper, spouse, child], externalBeneficiaries: [], year: 2045,
    });
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].via).toBe("fallback_children");
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(
      r.transfers.some((t) => t.recipientKind === "spouse" && t.recipientId == null),
    ).toBe(false);
  });

  it("condition-gated bequest: if_spouse_predeceased at first death (spouse alive) → ignored, routes to spouse fallback", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to child if spouse predeceased", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "biz-1", liabilityId: null, percentage: 100,
        condition: "if_spouse_predeceased", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fmChild", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: "fmSpouse",
      deathOrder: 1, accounts: [biz], accountBalances: balances,
      will, familyMembers: [cooper, spouse, child], externalBeneficiaries: [], year: 2030,
    });
    expect(r.transfers[0].recipientKind).toBe("spouse");
    expect(r.transfers[0].recipientId).toBe("fmSpouse");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmSpouse", percent: 1 }]);
  });

  it("condition-gated bequest: if_spouse_predeceased at final death (no survivor) → fires, routes to child", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const will: Will = {
      id: "w1", grantor: "client", bequests: [{
        id: "b1", name: "LLC to child if spouse predeceased", kind: "asset", assetMode: "specific",
        accountId: null, entityId: "biz-1", liabilityId: null, percentage: 100,
        condition: "if_spouse_predeceased", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fmChild", percentage: 100, sortOrder: 0 }],
      }],
    };
    const r = applyBusinessSuccession({
      deceased: "client", deceasedFmId: "fmCooper", survivorFmId: null,
      deathOrder: 2, accounts: [biz], accountBalances: balances,
      will, familyMembers: [cooper, child], externalBeneficiaries: [], year: 2035,
    });
    expect(r.transfers[0].recipientId).toBe("fmChild");
    expect(r.ownerUpdates[0].successors).toEqual([{ familyMemberId: "fmChild", percent: 1 }]);
  });
});

describe("applyBusinessSuccession — child accounts cascade via parentAccountId", () => {
  // Phase 4 Decision 3: child accounts hanging off a business via
  // parentAccountId are not touched directly by succession — they
  // continue to inherit ownership from the parent's flipped owners[].
  // This regression locks in that behavior so a future change can't
  // silently start mutating children.
  it("child cash account is NOT touched by succession; inherits via the parent's new owners", () => {
    const biz = llcAccount([{ familyMemberId: "fmCooper", percent: 1 }]);
    const childCash: Account = {
      id: "biz-1-cash",
      name: "LLC Operating Cash",
      category: "cash",
      subType: "checking",
      value: 5_000,
      basis: 5_000,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      parentAccountId: "biz-1",
      owners: [],
    };

    const r = applyBusinessSuccession({
      deceased: "client",
      deceasedFmId: "fmCooper",
      survivorFmId: "fmSpouse",
      deathOrder: 1,
      accounts: [biz, childCash],
      // Consolidated value picks up the child: biz $10k + child $5k = $15k.
      accountBalances: { "biz-1": 10_000, "biz-1-cash": 5_000 },
      will: null,
      familyMembers: [cooper, spouse],
      externalBeneficiaries: [],
      year: 2030,
    });

    // Only the parent business should appear in ownerUpdates — child accounts
    // are owned through the parent and aren't given their own account_owners.
    expect(r.ownerUpdates).toHaveLength(1);
    expect(r.ownerUpdates[0].accountId).toBe("biz-1");
    expect(r.ownerUpdates[0].successors).toEqual([
      { familyMemberId: "fmSpouse", percent: 1 },
    ]);

    // The child account's parentAccountId is unchanged — the cascade
    // happens by virtue of the parent's owners[] flip alone.
    expect(childCash.parentAccountId).toBe("biz-1");
    expect(childCash.owners).toEqual([]);

    // Transfer amount reflects the consolidated business value, not just the
    // parent's flat value — the child's balance flows with the business.
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].sourceAccountId).toBe("biz-1");
    expect(r.transfers[0].amount).toBe(15_000);
  });
});
