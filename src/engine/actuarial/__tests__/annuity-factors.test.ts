import { describe, it, expect } from "vitest";
import {
  jointLifeAnnuityFactor,
  shorterOfYearsOrLifeAnnuityFactor,
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

  it("pinned snapshot against the 2010CM table: ages 65/80/90, r=4%", () => {
    // (1 - A_x) / i against the official 2010CM mortality table, per
    // Treas. Reg. §20.2031-7(d)(2)(ii)(B). These are the engine's EOY/UDD
    // convention values on 2010CM; they run ~1-3% above the official IRS
    // Table S (a documented, pre-existing convention difference). The pins
    // guard the table+formula so a wrong mortality table can't slip through.
    expect(singleLifeAnnuityFactor({ age: 65, irc7520Rate: 0.04 })).toBeCloseTo(12.6912, 3);
    expect(singleLifeAnnuityFactor({ age: 80, irc7520Rate: 0.04 })).toBeCloseTo(7.4209, 3);
    expect(singleLifeAnnuityFactor({ age: 90, irc7520Rate: 0.04 })).toBeCloseTo(4.3099, 3);
  });
});

describe("jointLifeAnnuityFactor", () => {
  it("returns a positive finite value for ages 65+62, r=4%", () => {
    const a = jointLifeAnnuityFactor({ age1: 65, age2: 62, irc7520Rate: 0.04 });
    expect(a).toBeGreaterThan(0);
    expect(Number.isFinite(a)).toBe(true);
  });

  it("joint last-survivor exceeds single life (younger lives longer expected)", () => {
    const aJoint = jointLifeAnnuityFactor({ age1: 65, age2: 62, irc7520Rate: 0.04 });
    const aSingle65 = singleLifeAnnuityFactor({ age: 65, irc7520Rate: 0.04 });
    const aSingle62 = singleLifeAnnuityFactor({ age: 62, irc7520Rate: 0.04 });
    expect(aJoint).toBeGreaterThan(aSingle65);
    expect(aJoint).toBeGreaterThan(aSingle62);
  });

  it("rejects ages out of range", () => {
    expect(() =>
      jointLifeAnnuityFactor({ age1: -1, age2: 62, irc7520Rate: 0.04 }),
    ).toThrow(/age/);
  });
});

describe("shorterOfYearsOrLifeAnnuityFactor", () => {
  it("returns a positive finite value for age 65, n=10, r=4%", () => {
    const a = shorterOfYearsOrLifeAnnuityFactor({
      age: 65,
      termYears: 10,
      irc7520Rate: 0.04,
    });
    expect(a).toBeGreaterThan(0);
    expect(Number.isFinite(a)).toBe(true);
  });

  it("shorter-of <= term-certain (shorter term cannot exceed pure term)", () => {
    const aShorterOf = shorterOfYearsOrLifeAnnuityFactor({
      age: 65,
      termYears: 10,
      irc7520Rate: 0.04,
    });
    const aTermCertain = termCertainAnnuityFactor({
      irc7520Rate: 0.04,
      termYears: 10,
    });
    expect(aShorterOf).toBeLessThanOrEqual(aTermCertain);
  });

  it("shorter-of <= single-life (mortality cutoff caps single-life)", () => {
    const aShorterOf = shorterOfYearsOrLifeAnnuityFactor({
      age: 65,
      termYears: 10,
      irc7520Rate: 0.04,
    });
    const aSingleLife = singleLifeAnnuityFactor({
      age: 65,
      irc7520Rate: 0.04,
    });
    expect(aShorterOf).toBeLessThanOrEqual(aSingleLife);
  });
});
