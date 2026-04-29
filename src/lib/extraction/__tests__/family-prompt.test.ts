import { describe, expect, it } from "vitest";
import { FAMILY_PROMPT, FAMILY_VERSION } from "../prompts/family";
import { extractedPayloadSchema } from "../extraction-schema";

describe("FAMILY_PROMPT", () => {
  it("declares a non-empty version constant", () => {
    expect(FAMILY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("instructs the model to skip SSNs and other government IDs", () => {
    expect(FAMILY_PROMPT).toMatch(/SSN|Social Security/i);
    expect(FAMILY_PROMPT).toMatch(/DO NOT|do not extract/i);
  });

  it("declares the four IRS filing-status strings literally", () => {
    expect(FAMILY_PROMPT).toContain("single");
    expect(FAMILY_PROMPT).toContain("married_filing_jointly");
    expect(FAMILY_PROMPT).toContain("married_filing_separately");
    expect(FAMILY_PROMPT).toContain("head_of_household");
  });

  it("documents the relationship and role enums", () => {
    expect(FAMILY_PROMPT).toContain("child");
    expect(FAMILY_PROMPT).toContain("grandchild");
    expect(FAMILY_PROMPT).toContain("parent");
    expect(FAMILY_PROMPT).toContain("sibling");
    expect(FAMILY_PROMPT).toContain("other");
  });
});

describe("family payload validation through extractedPayloadSchema", () => {
  it("accepts a populated family payload nested under the family key", () => {
    const result = extractedPayloadSchema.safeParse({
      family: {
        primary: {
          firstName: "John",
          lastName: "Smith",
          dateOfBirth: "1970-04-12",
          filingStatus: "married_filing_jointly",
        },
        spouse: {
          firstName: "Jane",
          lastName: "Smith",
          dateOfBirth: "1972-08-03",
        },
        dependents: [
          {
            firstName: "Sam",
            dateOfBirth: "2010-01-15",
            relationship: "child",
            role: "child",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty family payload (only dependents = [])", () => {
    const result = extractedPayloadSchema.safeParse({
      family: { dependents: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown root keys as before (defense against prompt-injection drift)", () => {
    const result = extractedPayloadSchema.safeParse({
      family: { dependents: [] },
      unknownKey: "should not pass",
    });
    expect(result.success).toBe(false);
  });

  it("caps dependents at 30 to prevent runaway extraction", () => {
    const dependents = Array.from({ length: 31 }, (_, i) => ({
      firstName: `Kid ${i}`,
    }));
    const result = extractedPayloadSchema.safeParse({
      family: { dependents },
    });
    expect(result.success).toBe(false);
  });
});
