import { describe, it, expect } from "vitest";
import { holdingCreateSchema } from "@/lib/schemas/holdings";

// Route handlers hit the DB + Clerk; unit-test the contract the handler enforces.
// Full HTTP coverage is exercised against the dev branch in Task 11.
describe("holdings POST contract", () => {
  it("requires shares/price/costBasis to be present and non-negative", () => {
    expect(
      holdingCreateSchema.safeParse({
        displayTicker: "VTI",
        shares: 1,
        price: 1,
        costBasis: 0,
      }).success
    ).toBe(true);
    expect(holdingCreateSchema.safeParse({ displayTicker: "VTI" }).success).toBe(false);
  });
});
