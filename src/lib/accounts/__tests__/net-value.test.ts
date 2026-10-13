import { describe, it, expect } from "vitest";
import { netAccountValue } from "../net-value";
describe("netAccountValue", () => {
  it("subtracts the margin loan", () => expect(netAccountValue({ value: "10000000", marginBalance: "2000000" })).toBe(8_000_000));
  it("treats a missing loan as zero", () => expect(netAccountValue({ value: 500 })).toBe(500));
  it("handles null value", () => expect(netAccountValue({ value: null, marginBalance: null })).toBe(0));
});
