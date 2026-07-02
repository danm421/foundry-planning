import { describe, it, expect } from "vitest";
import { computeRoth529Rollover, ROLLOVER_529_LIFETIME_CAP } from "../roth-rollover";

describe("computeRoth529Rollover", () => {
  it("caps at the annual IRA limit", () => {
    expect(computeRoth529Rollover({ balance: 30_000, lifetimeRolledSoFar: 0, annualIraLimit: 7_000 }))
      .toEqual({ amount: 7_000, lifetimeRolledAfter: 7_000 });
  });
  it("caps at remaining lifetime allowance", () => {
    expect(computeRoth529Rollover({ balance: 30_000, lifetimeRolledSoFar: 30_000, annualIraLimit: 7_000 }))
      .toEqual({ amount: 5_000, lifetimeRolledAfter: ROLLOVER_529_LIFETIME_CAP });
  });
  it("caps at balance", () => {
    expect(computeRoth529Rollover({ balance: 3_000, lifetimeRolledSoFar: 0, annualIraLimit: 7_000 }))
      .toEqual({ amount: 3_000, lifetimeRolledAfter: 3_000 });
  });
  it("zero once lifetime cap reached", () => {
    expect(computeRoth529Rollover({ balance: 10_000, lifetimeRolledSoFar: 35_000, annualIraLimit: 7_000 }).amount).toBe(0);
  });
});
