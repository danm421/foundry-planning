import { describe, it, expect } from "vitest";
import { encodeSignedAmount } from "@/lib/portal/transaction-amount";

describe("encodeSignedAmount", () => {
  it("stores expense as a positive amount (money out)", () => {
    expect(encodeSignedAmount(100, "expense")).toBe("100.00");
  });
  it("stores income as a negative amount (money in)", () => {
    expect(encodeSignedAmount(100, "income")).toBe("-100.00");
  });
  it("stores transfer as positive", () => {
    expect(encodeSignedAmount(50.5, "transfer")).toBe("50.50");
  });
  it("ignores an incoming sign and uses the type", () => {
    expect(encodeSignedAmount(-30, "expense")).toBe("30.00");
  });
});
