import { describe, it, expect } from "vitest";
import { computeClutInceptionInterests } from "../compute-clut-inception";

describe("computeClutInceptionInterests", () => {
  it("matches eMoney CRUT memo example exactly", () => {
    const result = computeClutInceptionInterests({
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
    const result = computeClutInceptionInterests({
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
    const result = computeClutInceptionInterests({
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
    expect(() => computeClutInceptionInterests({
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
