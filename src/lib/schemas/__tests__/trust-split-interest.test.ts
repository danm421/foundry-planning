import { describe, it, expect } from "vitest";
import { trustSplitInterestSchema } from "../trust-split-interest";

const base = {
  inceptionYear: 2026,
  inceptionValue: 1_000_000,
  payoutType: "unitrust" as const,
  payoutPercent: 0.06,
  irc7520Rate: 0.048,
  termType: "years" as const,
  termYears: 15,
  charityId: "11111111-1111-4111-9111-111111111111",
};

describe("trustSplitInterestSchema", () => {
  it("accepts a valid term-certain unitrust payload", () => {
    expect(() => trustSplitInterestSchema.parse(base)).not.toThrow();
  });

  it("rejects unitrust without payoutPercent", () => {
    const bad = { ...base, payoutPercent: undefined };
    expect(() => trustSplitInterestSchema.parse(bad)).toThrow();
  });

  it("rejects 'years' term without termYears", () => {
    const bad = { ...base, termYears: undefined };
    expect(() => trustSplitInterestSchema.parse(bad)).toThrow();
  });

  it("requires measuringLife1Id for single_life term", () => {
    const bad = { ...base, termType: "single_life" as const, termYears: undefined };
    expect(() => trustSplitInterestSchema.parse(bad)).toThrow();
    const good = {
      ...base,
      termType: "single_life" as const,
      termYears: undefined,
      measuringLife1Id: "22222222-2222-4222-9222-222222222222",
    };
    expect(() => trustSplitInterestSchema.parse(good)).not.toThrow();
  });

  it("requires both measuring lives for joint_life term", () => {
    const bad = {
      ...base,
      termType: "joint_life" as const,
      termYears: undefined,
      measuringLife1Id: "22222222-2222-4222-9222-222222222222",
    };
    expect(() => trustSplitInterestSchema.parse(bad)).toThrow();
    const good = {
      ...bad,
      measuringLife2Id: "33333333-3333-4333-9333-333333333333",
    };
    expect(() => trustSplitInterestSchema.parse(good)).not.toThrow();
  });

  it("rejects payoutPercent > 1 or < 0", () => {
    expect(() => trustSplitInterestSchema.parse({ ...base, payoutPercent: 1.5 })).toThrow();
    expect(() => trustSplitInterestSchema.parse({ ...base, payoutPercent: -0.01 })).toThrow();
  });

  it("accepts origin = 'new' with no originalIncomeInterest / originalRemainderInterest", () => {
    expect(() =>
      trustSplitInterestSchema.parse({ ...base, origin: "new" }),
    ).not.toThrow();
  });

  it("accepts origin defaulting to undefined (treated as 'new' downstream)", () => {
    expect(() => trustSplitInterestSchema.parse(base)).not.toThrow();
  });

  it("rejects origin = 'existing' without originalIncomeInterest", () => {
    const bad = {
      ...base,
      origin: "existing" as const,
      originalRemainderInterest: 538_615,
    };
    expect(() => trustSplitInterestSchema.parse(bad)).toThrow();
  });

  it("rejects origin = 'existing' without originalRemainderInterest", () => {
    const bad = {
      ...base,
      origin: "existing" as const,
      originalIncomeInterest: 461_385,
    };
    expect(() => trustSplitInterestSchema.parse(bad)).toThrow();
  });

  it("accepts origin = 'existing' with both historical values supplied", () => {
    const good = {
      ...base,
      origin: "existing" as const,
      originalIncomeInterest: 461_385,
      originalRemainderInterest: 538_615,
    };
    expect(() => trustSplitInterestSchema.parse(good)).not.toThrow();
  });
});
