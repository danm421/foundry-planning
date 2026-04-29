import { describe, expect, it } from "vitest";
import { WILL_PROMPT, WILL_VERSION } from "../prompts/will";
import { extractedPayloadSchema } from "../extraction-schema";

describe("WILL_PROMPT", () => {
  it("declares a versioned constant", () => {
    expect(WILL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("instructs the model NOT to invent matched account numbers", () => {
    expect(WILL_PROMPT).toMatch(/DO NOT|do not invent/i);
    expect(WILL_PROMPT).toMatch(/account numbers|matched accounts/i);
  });

  it("documents the three condition values literally", () => {
    expect(WILL_PROMPT).toContain("none");
    expect(WILL_PROMPT).toContain("if_predeceased");
    expect(WILL_PROMPT).toContain("per_stirpes");
  });

  it("documents the two grantor values literally", () => {
    expect(WILL_PROMPT).toContain("client");
    expect(WILL_PROMPT).toContain("spouse");
  });
});

describe("will payload validation through extractedPayloadSchema", () => {
  it("accepts a populated wills array", () => {
    const result = extractedPayloadSchema.safeParse({
      wills: [
        {
          grantor: "client",
          executor: "Jane Smith",
          executionDate: "2020-06-15",
          bequests: [
            {
              recipientNameHint: "spouse Jane Doe",
              assetDescriptionHint: "all retirement accounts",
              percentage: 100,
              condition: "none",
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty wills array", () => {
    const result = extractedPayloadSchema.safeParse({ wills: [] });
    expect(result.success).toBe(true);
  });

  it("caps wills at 4 (one per grantor + buffer)", () => {
    const wills = Array.from({ length: 5 }, () => ({
      grantor: "client",
      bequests: [],
    }));
    const result = extractedPayloadSchema.safeParse({ wills });
    expect(result.success).toBe(false);
  });

  it("caps bequests per will at 30", () => {
    const bequests = Array.from({ length: 31 }, (_, i) => ({
      recipientNameHint: `Recipient ${i}`,
      assetDescriptionHint: "share of estate",
      percentage: 1,
    }));
    const result = extractedPayloadSchema.safeParse({
      wills: [{ grantor: "client", bequests }],
    });
    expect(result.success).toBe(false);
  });
});
