import { describe, expect, it } from "vitest";
import { isFreshHousehold } from "../is-fresh-household";

describe("isFreshHousehold", () => {
  it("returns true when account count is 0", () => {
    expect(isFreshHousehold(0)).toBe(true);
  });

  it("returns false when account count is 1", () => {
    expect(isFreshHousehold(1)).toBe(false);
  });

  it("returns false for many accounts", () => {
    expect(isFreshHousehold(42)).toBe(false);
  });
});
