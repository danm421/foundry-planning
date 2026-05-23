import { describe, it, expect } from "vitest";
import { computeCrtInceptionInterests } from "../compute-crt-inception";

describe("computeCrtInceptionInterests", () => {
  it("returns CRUT charitable deduction = inception × remainder factor (term-certain)", () => {
    // (1 - 0.06)^10 = 0.5386151
    // deduction = 1,000,000 × 0.5386151 = 538,615
    // income interest = 1,000,000 - 538,615 = 461,385
    const result = computeCrtInceptionInterests({
      inceptionValue: 1_000_000,
      payoutType: "unitrust",
      payoutPercent: 0.06,
      payoutAmount: undefined,
      irc7520Rate: 0.022,
      termType: "years",
      termYears: 10,
      measuringLifeAge1: undefined,
      measuringLifeAge2: undefined,
    });
    expect(result.charitableDeduction).toBeCloseTo(538_615, 0);
    expect(result.incomeInterest).toBeCloseTo(461_385, 0);
    expect(result.charitableDeduction + result.incomeInterest).toBeCloseTo(1_000_000, 0);
  });

  it("returns CRAT charitable deduction = inception − payoutAmount × a_n (term-certain)", () => {
    // r=4%, n=10 → a_n = 8.110896
    // income interest = 60,000 × 8.110896 = 486,654
    // charitable deduction = 1,000,000 − 486,654 = 513,346
    const result = computeCrtInceptionInterests({
      inceptionValue: 1_000_000,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 60_000,
      irc7520Rate: 0.04,
      termType: "years",
      termYears: 10,
      measuringLifeAge1: undefined,
      measuringLifeAge2: undefined,
    });
    expect(result.incomeInterest).toBeCloseTo(486_654, 0);
    expect(result.charitableDeduction).toBeCloseTo(513_346, 0);
  });

  it("computes single-life CRUT from measuringLifeAge1", () => {
    const result = computeCrtInceptionInterests({
      inceptionValue: 1_000_000,
      payoutType: "unitrust",
      payoutPercent: 0.05,
      payoutAmount: undefined,
      irc7520Rate: 0.05,
      termType: "single_life",
      termYears: undefined,
      measuringLifeAge1: 65,
      measuringLifeAge2: undefined,
    });
    expect(result.charitableDeduction).toBeGreaterThan(0);
    expect(result.incomeInterest).toBeGreaterThan(0);
    expect(result.charitableDeduction + result.incomeInterest).toBeCloseTo(1_000_000, 0);
  });

  it("computes joint-life CRAT from both measuring ages", () => {
    const result = computeCrtInceptionInterests({
      inceptionValue: 2_000_000,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 100_000,
      irc7520Rate: 0.05,
      termType: "joint_life",
      termYears: undefined,
      measuringLifeAge1: 65,
      measuringLifeAge2: 63,
    });
    expect(result.charitableDeduction).toBeGreaterThan(0);
    expect(result.incomeInterest).toBeGreaterThan(0);
    expect(result.charitableDeduction + result.incomeInterest).toBeCloseTo(2_000_000, 0);
  });

  it("rounds to whole dollars and conserves total", () => {
    const result = computeCrtInceptionInterests({
      inceptionValue: 1_234_567,
      payoutType: "unitrust",
      payoutPercent: 0.05,
      payoutAmount: undefined,
      irc7520Rate: 0.05,
      termType: "years",
      termYears: 15,
      measuringLifeAge1: undefined,
      measuringLifeAge2: undefined,
    });
    expect(result.charitableDeduction + result.incomeInterest).toBeCloseTo(1_234_567, 0);
  });

  it("throws when single_life is missing measuringLifeAge1", () => {
    expect(() =>
      computeCrtInceptionInterests({
        inceptionValue: 1_000_000,
        payoutType: "unitrust",
        payoutPercent: 0.05,
        payoutAmount: undefined,
        irc7520Rate: 0.05,
        termType: "single_life",
        termYears: undefined,
        measuringLifeAge1: undefined,
        measuringLifeAge2: undefined,
      }),
    ).toThrow(/measuringLifeAge1/);
  });

  it("throws when unitrust is missing payoutPercent", () => {
    expect(() =>
      computeCrtInceptionInterests({
        inceptionValue: 1_000_000,
        payoutType: "unitrust",
        payoutPercent: undefined,
        payoutAmount: undefined,
        irc7520Rate: 0.05,
        termType: "years",
        termYears: 10,
        measuringLifeAge1: undefined,
        measuringLifeAge2: undefined,
      }),
    ).toThrow(/payoutPercent/);
  });

  it("throws when annuity is missing payoutAmount", () => {
    expect(() =>
      computeCrtInceptionInterests({
        inceptionValue: 1_000_000,
        payoutType: "annuity",
        payoutPercent: undefined,
        payoutAmount: undefined,
        irc7520Rate: 0.05,
        termType: "years",
        termYears: 10,
        measuringLifeAge1: undefined,
        measuringLifeAge2: undefined,
      }),
    ).toThrow(/payoutAmount/);
  });
});
