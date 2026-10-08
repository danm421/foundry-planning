// src/lib/insurance-policies/__tests__/ltc-rider-link.test.ts
import { describe, it, expect } from "vitest";
import { riderLinkProblem, eligibleRiderPolicies } from "../ltc-rider-link";

const life = (insuredPerson: "client" | "spouse" | "joint" | null, category = "life_insurance") => ({
  id: "a1", category, insuredPerson,
});

describe("riderLinkProblem", () => {
  it("accepts the insured's own life policy", () => {
    expect(riderLinkProblem("client", life("client"))).toBeNull();
  });
  it("refuses a missing account or one that is not life insurance", () => {
    expect(riderLinkProblem("client", null)).toBe("Pick one of this household's life insurance policies.");
    expect(riderLinkProblem("client", life("client", "taxable"))).toBe("Pick one of this household's life insurance policies.");
  });
  it("refuses a joint policy and another person's policy", () => {
    expect(riderLinkProblem("client", life("joint"))).toBe("A rider can't sit on a joint (second-to-die) policy.");
    expect(riderLinkProblem("client", life("spouse"))).toBe("The life policy must insure the same person as the rider.");
  });
});

describe("eligibleRiderPolicies", () => {
  it("keeps only the insured's own policies", () => {
    const ps = [
      { id: "c", insuredPerson: "client" as const },
      { id: "s", insuredPerson: "spouse" as const },
      { id: "j", insuredPerson: "joint" as const },
    ];
    expect(eligibleRiderPolicies("spouse", ps).map((p) => p.id)).toEqual(["s"]);
  });
});
