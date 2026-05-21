import { describe, it, expect } from "vitest";
import { termCertainAnnuityFactor } from "../annuity-factors";

describe("termCertainAnnuityFactor", () => {
  it("matches IRS Pub 1457 Table B example: r=4.0%, n=10", () => {
    // a_n = (1 - v^n) / r where v = 1/(1+r)
    // r=0.04, n=10 → 8.110896...
    const a = termCertainAnnuityFactor({ irc7520Rate: 0.04, termYears: 10 });
    expect(a).toBeCloseTo(8.110896, 5);
  });

  it("matches Pub 1457 Table B example: r=2.2%, n=10", () => {
    // r=0.022, n=10 → ((1 - (1/1.022)^10) / 0.022) ≈ 8.889311
    const a = termCertainAnnuityFactor({ irc7520Rate: 0.022, termYears: 10 });
    expect(a).toBeCloseTo(8.889311, 5);
  });

  it("rejects non-positive termYears", () => {
    expect(() =>
      termCertainAnnuityFactor({ irc7520Rate: 0.04, termYears: 0 }),
    ).toThrow(/termYears/);
  });

  it("rejects irc7520Rate <= 0", () => {
    expect(() =>
      termCertainAnnuityFactor({ irc7520Rate: 0, termYears: 10 }),
    ).toThrow(/irc7520Rate/);
  });
});
