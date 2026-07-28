import { describe, it, expect } from "vitest";
import { moneyLabel } from "../format";

describe("moneyLabel", () => {
  it("renders a positive value plainly", () => {
    expect(moneyLabel(160000)).toBe("$160,000");
  });

  it("renders a negative value in accounting parens, not a leading minus", () => {
    expect(moneyLabel(-10000)).toBe("($10,000)");
  });

  it("renders zero plainly", () => {
    expect(moneyLabel(0)).toBe("$0");
  });

  it("renders negative zero as $0, not -$0 (the guard this function exists for)", () => {
    expect(moneyLabel(-0)).toBe("$0");
  });
});
