import { describe, it, expect } from "vitest";
import { clientCreateSchema } from "../resources";

const base = {
  crmHouseholdId: "11111111-1111-4111-8111-111111111111",
  retirementAge: 65,
  lifeExpectancy: 90,
  filingStatus: "single" as const,
};

describe("clientCreateSchema — life expectancy floor", () => {
  it("accepts a sub-40 life expectancy when death is in the future", () => {
    // The old schema rejected sub-40 lifeExpectancy via min(40); the new schema
    // only enforces min(1) so premature-death what-ifs are allowed.
    const result = clientCreateSchema.safeParse({
      ...base,
      lifeExpectancy: 30,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a life expectancy below the absolute floor", () => {
    const result = clientCreateSchema.safeParse({
      ...base,
      lifeExpectancy: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a spouse life expectancy below the absolute floor", () => {
    const result = clientCreateSchema.safeParse({
      ...base,
      filingStatus: "married_joint",
      spouseLifeExpectancy: 0,
    });
    expect(result.success).toBe(false);
  });
});
