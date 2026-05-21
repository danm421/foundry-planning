import { describe, it, expect } from "vitest";
import {
  singleLifeAnnuityFactor,
  termCertainAnnuityFactor,
} from "../annuity-factors";

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

describe("singleLifeAnnuityFactor", () => {
  it("returns a positive finite value for age 65, r=4%", () => {
    const a = singleLifeAnnuityFactor({ age: 65, irc7520Rate: 0.04 });
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(30);
    expect(Number.isFinite(a)).toBe(true);
  });

  it("rejects age out of [0, 110]", () => {
    expect(() =>
      singleLifeAnnuityFactor({ age: -1, irc7520Rate: 0.04 }),
    ).toThrow(/age/);
    expect(() =>
      singleLifeAnnuityFactor({ age: 111, irc7520Rate: 0.04 }),
    ).toThrow(/age/);
  });

  it("monotonically decreases as age increases (older = shorter expected term)", () => {
    const a40 = singleLifeAnnuityFactor({ age: 40, irc7520Rate: 0.04 });
    const a65 = singleLifeAnnuityFactor({ age: 65, irc7520Rate: 0.04 });
    const a85 = singleLifeAnnuityFactor({ age: 85, irc7520Rate: 0.04 });
    expect(a40).toBeGreaterThan(a65);
    expect(a65).toBeGreaterThan(a85);
  });

  it("pinned snapshot: age 65, r=4% (regression guard)", () => {
    const a = singleLifeAnnuityFactor({ age: 65, irc7520Rate: 0.04 });
    // EOY annuity-in-arrears (Σ v^t × tpx) against 2010CM; this is below the
    // Pub 1457 Table S figure (~13.4) because Table S uses half-year timing.
    expect(a).toBeCloseTo(11.47, 2);
  });
});
