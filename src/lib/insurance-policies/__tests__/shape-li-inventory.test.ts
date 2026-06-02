// src/lib/insurance-policies/__tests__/shape-li-inventory.test.ts
import { describe, it, expect } from "vitest";
import { shapeLiInventory, type RawLiInventory } from "../load-li-inventory";

const raw: RawLiInventory = {
  clientName: "Cooper",
  spouseName: "Dana",
  accounts: [
    { id: "p1", name: "Term 20", subType: "term", insuredPerson: "client", value: 0 },
    { id: "p2", name: "WL", subType: "whole_life", insuredPerson: "client", value: 180_000 },
  ],
  policies: {
    p1: { faceValue: 1_000_000, premiumAmount: 1_200, policyType: "term", termIssueYear: 2021, termLengthYears: 20, carrier: "Northwestern" },
    p2: { faceValue: 250_000, premiumAmount: 4_000, policyType: "whole", termIssueYear: null, termLengthYears: null, carrier: "MassMutual" },
  },
  owners: { p1: "client", p2: "client" },
  beneficiaries: {
    p1: [
      { tier: "primary", percentage: 100, familyMemberId: null, externalBeneficiaryId: null, entityIdRef: null, householdRole: "spouse" },
      { tier: "contingent", percentage: 100, familyMemberId: "fm1", externalBeneficiaryId: null, entityIdRef: null, householdRole: null },
    ],
  },
  familyMemberNames: { fm1: "Children Trust" },
  externalNames: {},
  entityNames: {},
};

describe("shapeLiInventory", () => {
  it("shapes policy rows with resolved labels, term expiry, and beneficiaries", () => {
    const inv = shapeLiInventory(raw);
    expect(inv.policies).toHaveLength(2);

    const p1 = inv.policies[0];
    expect(p1.name).toBe("Term 20");
    expect(p1.policyType).toBe("term");
    expect(p1.deathBenefit).toBe(1_000_000);
    expect(p1.cashValue).toBe(0);
    expect(p1.insuredLabel).toBe("Cooper");
    expect(p1.ownerLabel).toBe("Cooper");
    expect(p1.termExpiryYear).toBe(2041); // 2021 + 20
    expect(p1.carrier).toBe("Northwestern");
    expect(p1.beneficiaries).toEqual([
      { tier: "primary", name: "Dana", percentage: 100 },
      { tier: "contingent", name: "Children Trust", percentage: 100 },
    ]);

    const p2 = inv.policies[1];
    expect(p2.cashValue).toBe(180_000);
    expect(p2.termExpiryYear).toBeNull();
  });
});
