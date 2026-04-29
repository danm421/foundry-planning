import { describe, expect, it } from "vitest";
import {
  LIFE_INSURANCE_PROMPT,
  LIFE_INSURANCE_VERSION,
} from "../prompts/life-insurance";
import { extractedPayloadSchema } from "../extraction-schema";

describe("LIFE_INSURANCE_PROMPT", () => {
  it("declares a versioned constant", () => {
    expect(LIFE_INSURANCE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("documents the four policy types literally", () => {
    expect(LIFE_INSURANCE_PROMPT).toContain("term");
    expect(LIFE_INSURANCE_PROMPT).toContain("whole");
    expect(LIFE_INSURANCE_PROMPT).toContain("universal");
    expect(LIFE_INSURANCE_PROMPT).toContain("variable");
  });

  it("instructs the model to capture only last-4 of policy number", () => {
    expect(LIFE_INSURANCE_PROMPT).toMatch(/policyNumberLast4/);
    expect(LIFE_INSURANCE_PROMPT).toMatch(/last 4|four/i);
  });

  it("normalizes premium to annual", () => {
    expect(LIFE_INSURANCE_PROMPT).toMatch(/multiply by 12/);
  });
});

describe("life-insurance payload validation through extractedPayloadSchema", () => {
  it("accepts a populated lifePolicies array", () => {
    const result = extractedPayloadSchema.safeParse({
      lifePolicies: [
        {
          carrier: "Northwestern Mutual",
          policyNumberLast4: "6789",
          policyType: "term",
          insuredPerson: "client",
          faceValue: 1000000,
          premiumAmount: 1200,
          accountName: "Northwestern Mutual Term — 6789",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty lifePolicies array", () => {
    const result = extractedPayloadSchema.safeParse({ lifePolicies: [] });
    expect(result.success).toBe(true);
  });

  it("caps lifePolicies at 50", () => {
    const lifePolicies = Array.from({ length: 51 }, (_, i) => ({
      policyType: "term",
      insuredPerson: "client",
      faceValue: 100000,
      accountName: `Policy ${i}`,
    }));
    const result = extractedPayloadSchema.safeParse({ lifePolicies });
    expect(result.success).toBe(false);
  });
});
