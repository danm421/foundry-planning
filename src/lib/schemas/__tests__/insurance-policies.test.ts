import { describe, it, expect } from "vitest";
import { insurancePolicyCreateSchema } from "../insurance-policies";

const validBase = {
  name: "Cooper - Term",
  policyType: "term" as const,
  insuredPerson: "client" as const,
  ownerRef: { kind: "entity" as const, id: "11111111-1111-1111-1111-111111111111" },
  faceValue: 1_000_000,
  termIssueYear: 2026,
  termLengthYears: 20,
};

describe("insurancePolicyCreateSchema premiumPayer", () => {
  it("defaults premiumPayer to 'owner' when omitted", () => {
    const parsed = insurancePolicyCreateSchema.parse(validBase);
    expect(parsed.premiumPayer).toBe("owner");
  });

  it("accepts an explicit payer", () => {
    const parsed = insurancePolicyCreateSchema.parse({ ...validBase, premiumPayer: "both" });
    expect(parsed.premiumPayer).toBe("both");
  });

  it("rejects an unknown payer", () => {
    expect(() => insurancePolicyCreateSchema.parse({ ...validBase, premiumPayer: "nephew" })).toThrow();
  });
});
