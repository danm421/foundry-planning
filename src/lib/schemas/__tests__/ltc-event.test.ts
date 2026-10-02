import { describe, it, expect } from "vitest";
import { ltcEventSchema } from "../ltc-event";

const valid = {
  id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566",
  name: "Long-term care — John 85–87",
  people: [
    { person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 },
  ],
  livingExpenseCutPct: 1,
  homeSale: null,
  includePolicies: true,
};

describe("ltcEventSchema", () => {
  it("accepts a valid event", () => {
    expect(ltcEventSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects the same person twice", () => {
    const twice = { ...valid, people: [valid.people[0], valid.people[0]] };
    expect(ltcEventSchema.safeParse(twice).success).toBe(false);
  });
  it("rejects zero years, a cut above 100%, and a non-uuid id", () => {
    expect(ltcEventSchema.safeParse({ ...valid, people: [{ ...valid.people[0], years: 0 }] }).success).toBe(false);
    expect(ltcEventSchema.safeParse({ ...valid, livingExpenseCutPct: 1.2 }).success).toBe(false);
    expect(ltcEventSchema.safeParse({ ...valid, id: "ltc-1" }).success).toBe(false);
  });
  it("rejects a custom sale price of 0", () => {
    const sale = { accountId: "a", saleYear: 2055, price: { mode: "custom", amount: 0 }, sellingCostPct: 0.06 };
    expect(ltcEventSchema.safeParse({ ...valid, homeSale: sale }).success).toBe(false);
  });
});
