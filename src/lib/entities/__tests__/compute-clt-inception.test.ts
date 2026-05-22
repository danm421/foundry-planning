import { describe, it, expect } from "vitest";
import { computeCltInceptionInterests } from "../compute-clt-inception";

describe("computeCltInceptionInterests", () => {
  it("matches eMoney CRUT memo example exactly", () => {
    const result = computeCltInceptionInterests({
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
    // Per memo: remainder factor = 0.538615
    // Income interest = 1,000,000 - 538,615 = 461,385
    expect(result.originalRemainderInterest).toBeCloseTo(538_615, 0);
    expect(result.originalIncomeInterest).toBeCloseTo(461_385, 0);
  });

  it("rounds to dollar precision for storage", () => {
    const result = computeCltInceptionInterests({
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
    expect(result.originalIncomeInterest + result.originalRemainderInterest).toBeCloseTo(1_234_567, 0);
  });

  it("computes single-life from measuringLifeAge1", () => {
    const result = computeCltInceptionInterests({
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
    expect(result.originalRemainderInterest).toBeGreaterThan(0);
    expect(result.originalIncomeInterest).toBeGreaterThan(0);
  });

  it("throws when single_life is missing measuringLifeAge1", () => {
    expect(() => computeCltInceptionInterests({
      inceptionValue: 1_000_000,
      payoutType: "unitrust",
      payoutPercent: 0.05,
      payoutAmount: undefined,
      irc7520Rate: 0.05,
      termType: "single_life",
      termYears: undefined,
      measuringLifeAge1: undefined,
      measuringLifeAge2: undefined,
    })).toThrow(/measuringLifeAge1/);
  });
});

describe("computeCltInceptionInterests (annuity / CLAT path)", () => {
  it("computes term-certain CLAT income = payoutAmount × a_n", () => {
    // r=4%, n=10 → a_n = 8.110896
    // payoutAmount=$60,000 → income = $486,653.76 → $486,654
    // remainder = $1,000,000 - $486,654 = $513,346
    const result = computeCltInceptionInterests({
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
    expect(result.originalIncomeInterest).toBeCloseTo(486_654, 0);
    expect(result.originalRemainderInterest).toBeCloseTo(513_346, 0);
  });

  it("throws when annuity is missing payoutAmount", () => {
    expect(() =>
      computeCltInceptionInterests({
        inceptionValue: 1_000_000,
        payoutType: "annuity",
        payoutPercent: undefined,
        payoutAmount: undefined,
        irc7520Rate: 0.04,
        termType: "years",
        termYears: 10,
        measuringLifeAge1: undefined,
        measuringLifeAge2: undefined,
      }),
    ).toThrow(/payoutAmount/);
  });

  it("computes single-life CLAT from measuringLifeAge1", () => {
    const result = computeCltInceptionInterests({
      inceptionValue: 1_000_000,
      payoutType: "annuity",
      payoutPercent: undefined,
      payoutAmount: 50_000,
      irc7520Rate: 0.04,
      termType: "single_life",
      termYears: undefined,
      measuringLifeAge1: 65,
      measuringLifeAge2: undefined,
    });
    expect(result.originalIncomeInterest).toBeGreaterThan(0);
    expect(result.originalRemainderInterest).toBeGreaterThan(0);
    expect(
      result.originalIncomeInterest + result.originalRemainderInterest,
    ).toBeCloseTo(1_000_000, 0);
  });

  it("throws when CLAT single_life is missing measuringLifeAge1", () => {
    expect(() =>
      computeCltInceptionInterests({
        inceptionValue: 1_000_000,
        payoutType: "annuity",
        payoutPercent: undefined,
        payoutAmount: 50_000,
        irc7520Rate: 0.04,
        termType: "single_life",
        termYears: undefined,
        measuringLifeAge1: undefined,
        measuringLifeAge2: undefined,
      }),
    ).toThrow(/measuringLifeAge1/);
  });
});
