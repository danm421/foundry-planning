import { describe, it, expect } from "vitest";
import {
  insurancePolicyCreateSchema,
  insurancePolicyUpdateSchema,
} from "../insurance-policies";

const validBase = {
  name: "Cooper - Term",
  policyType: "term" as const,
  insuredPerson: "client" as const,
  ownerRef: { kind: "entity" as const, id: "11111111-1111-1111-1111-111111111111" },
  faceValue: 1_000_000,
  termIssueYear: 2026,
  termLengthYears: 20,
};

describe("insurancePolicyCreateSchema activation fields", () => {
  it("preserves activationYear and activationYearRef when provided", () => {
    const result = insurancePolicyCreateSchema.safeParse({
      ...validBase,
      activationYear: 2035,
      activationYearRef: "client_retirement",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activationYear).toBe(2035);
      expect(result.data.activationYearRef).toBe("client_retirement");
    }
  });

  it("parses fine when activation fields are omitted", () => {
    const result = insurancePolicyCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activationYear).toBeUndefined();
      expect(result.data.activationYearRef).toBeUndefined();
    }
  });
});

describe("insurancePolicyUpdateSchema activation fields", () => {
  it("preserves activationYear and activationYearRef when provided", () => {
    const result = insurancePolicyUpdateSchema.safeParse({
      activationYear: 2035,
      activationYearRef: "client_retirement",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activationYear).toBe(2035);
      expect(result.data.activationYearRef).toBe("client_retirement");
    }
  });

  it("parses fine when activation fields are omitted", () => {
    const result = insurancePolicyUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activationYear).toBeUndefined();
      expect(result.data.activationYearRef).toBeUndefined();
    }
  });
});
