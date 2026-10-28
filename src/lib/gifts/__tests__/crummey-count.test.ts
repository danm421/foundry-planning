import { describe, it, expect } from "vitest";
import { crummeyBeneficiaryCount } from "../crummey-count";
import type { BeneficiaryRef } from "@/engine/types";

const b = (over: Partial<BeneficiaryRef>): BeneficiaryRef => ({
  id: "x", tier: "primary", percentage: 100, sortOrder: 0, ...over,
});

describe("crummeyBeneficiaryCount", () => {
  it("counts natural persons across primary AND contingent tiers", () => {
    const bens: BeneficiaryRef[] = [
      b({ tier: "primary", familyMemberId: "fm1" }),
      b({ tier: "contingent", externalBeneficiaryId: "eb1" }),
      b({ tier: "contingent", householdRole: "spouse" }),
    ];
    expect(crummeyBeneficiaryCount({ beneficiaries: bens })).toBe(3);
  });

  it("excludes sub-trust (entityIdRef) beneficiaries", () => {
    const bens: BeneficiaryRef[] = [
      b({ familyMemberId: "fm1" }),
      b({ entityIdRef: "trust2" }),
    ];
    expect(crummeyBeneficiaryCount({ beneficiaries: bens })).toBe(1);
  });

  it("does not count Other Heirs as a Crummey beneficiary", () => {
    const bens: BeneficiaryRef[] = [
      b({ familyMemberId: "fm1" }),
      b({ tier: "contingent", otherHeirs: true }),
    ];
    expect(crummeyBeneficiaryCount({ beneficiaries: bens })).toBe(1);
  });

  it("returns 0 when beneficiaries is undefined", () => {
    expect(crummeyBeneficiaryCount({})).toBe(0);
  });

  it("counts the trust's lifetime (income) beneficiaries", () => {
    expect(
      crummeyBeneficiaryCount({
        incomeBeneficiaries: [
          { familyMemberId: "fm1", percentage: 50 },
          { familyMemberId: "fm2", percentage: 50 },
        ],
      }),
    ).toBe(2);
  });

  it("counts a person once when they sit on both lists", () => {
    expect(
      crummeyBeneficiaryCount({
        incomeBeneficiaries: [{ familyMemberId: "fm1", percentage: 100 }],
        beneficiaries: [b({ familyMemberId: "fm1" })],
      }),
    ).toBe(1);
  });

  it("never counts the donor as their own Crummey holder", () => {
    const slat = { incomeBeneficiaries: [{ householdRole: "spouse" as const, percentage: 100 }] };
    expect(crummeyBeneficiaryCount(slat, { donor: "client" })).toBe(1);
    expect(crummeyBeneficiaryCount(slat, { donor: "spouse" })).toBe(0);
  });

  it("skips charities, sub-trusts and Other Heirs", () => {
    expect(
      crummeyBeneficiaryCount(
        {
          incomeBeneficiaries: [
            { externalBeneficiaryId: "ch1", percentage: 40 },
            { entityId: "t2", percentage: 30 },
            { otherHeirs: true, percentage: 30 },
          ],
        },
        { charityIds: new Set(["ch1"]) },
      ),
    ).toBe(0);
  });
});
