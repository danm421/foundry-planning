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

  it("returns 0 when beneficiaries is undefined", () => {
    expect(crummeyBeneficiaryCount({})).toBe(0);
  });
});
