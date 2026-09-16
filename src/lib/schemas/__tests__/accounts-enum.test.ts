import { describe, it, expect } from "vitest";
import { accountCategoryEnum, accountSubTypeEnum } from "@/db/schema";
import { accountCreateSchema } from "../accounts";

describe("account schema enums", () => {
  it("rejects a category that is not a database enum value", () => {
    const result = accountCreateSchema.safeParse({
      name: "Schwab Brokerage",
      category: "definitely_not_a_category",
      value: 1000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a subType that is not a database enum value", () => {
    const result = accountCreateSchema.safeParse({
      name: "Schwab Brokerage",
      category: accountCategoryEnum.enumValues[0],
      subType: "definitely_not_a_sub_type",
      value: 1000,
    });
    expect(result.success).toBe(false);
  });

  it("accepts every real category value", () => {
    for (const category of accountCategoryEnum.enumValues) {
      // "business" carries its own required-field superRefine
      // (AddBusinessInputSchema) that predates this task and is orthogonal
      // to the enum check under test here — supply its minimum valid shape
      // so this loop exercises the category enum, not the business branch.
      const businessExtra =
        category === "business"
          ? {
              businessType: "llc" as const,
              owners: [
                {
                  kind: "entity" as const,
                  entityId: "123e4567-e89b-42d3-a456-426614174000",
                  percent: 1,
                },
              ],
            }
          : {};
      const result = accountCreateSchema.safeParse({
        name: "Test",
        category,
        value: 1000,
        ...businessExtra,
      });
      expect(result.success, `category ${category} should parse`).toBe(true);
    }
  });

  it("still defaults subType to 'other' when the key is omitted", () => {
    const result = accountCreateSchema.safeParse({
      name: "Test",
      category: accountCategoryEnum.enumValues[0],
      value: 1000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.subType).toBe("other");
  });

  it("'other' is a real sub-type value, so the default is writable", () => {
    expect(accountSubTypeEnum.enumValues).toContain("other");
  });
});
