import { describe, it, expect } from "vitest";
import { roundUpTo50k } from "../round";

describe("roundUpTo50k", () => {
  it("returns 0 for 0", () => {
    expect(roundUpTo50k(0)).toBe(0);
  });
  it("rounds any positive value up to the next 50k multiple", () => {
    expect(roundUpTo50k(1)).toBe(50_000);
    expect(roundUpTo50k(49_999)).toBe(50_000);
    expect(roundUpTo50k(123_456)).toBe(150_000);
  });
  it("leaves exact 50k multiples unchanged", () => {
    expect(roundUpTo50k(50_000)).toBe(50_000);
    expect(roundUpTo50k(200_000)).toBe(200_000);
  });
});
