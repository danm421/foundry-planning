import { describe, it, expect } from "vitest";
import {
  computeCharitableDeductionForYear,
  type ComputeCharitableDeductionInput,
} from "../charitable-deduction";
import { emptyCharityCarryforward } from "../types";

function baseInput(over: Partial<ComputeCharitableDeductionInput> = {}): ComputeCharitableDeductionInput {
  return {
    giftsThisYear: [],
    agi: 1_000_000,
    carryforwardIn: emptyCharityCarryforward(),
    currentYear: 2026,
    willItemize: true,
    ...over,
  };
}

describe("computeCharitableDeductionForYear — single bucket within limits", () => {
  it("cashPublic gift below 60% AGI is fully deductible", () => {
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [{ amount: 100_000, bucket: "cashPublic" }],
        agi: 1_000_000,
      }),
    );
    expect(result.deductionThisYear).toBe(100_000);
    expect(result.byBucket.cashPublic).toBe(100_000);
  });

  it("cashPublic gift at exactly 60% AGI is fully deductible", () => {
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [{ amount: 600_000, bucket: "cashPublic" }],
        agi: 1_000_000,
      }),
    );
    expect(result.deductionThisYear).toBe(600_000);
  });

  it("cashPublic gift above 60% AGI deducts up to limit; excess carries forward", () => {
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [{ amount: 800_000, bucket: "cashPublic" }],
        agi: 1_000_000,
        currentYear: 2026,
      }),
    );
    expect(result.deductionThisYear).toBe(600_000);
    expect(result.carryforwardOut.cashPublic).toEqual([
      { amount: 200_000, originYear: 2026 },
    ]);
  });

  it("appreciatedPrivate gift respects 20% limit", () => {
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [{ amount: 300_000, bucket: "appreciatedPrivate" }],
        agi: 1_000_000,
      }),
    );
    expect(result.deductionThisYear).toBe(200_000);
    expect(result.carryforwardOut.appreciatedPrivate).toEqual([
      { amount: 100_000, originYear: 2026 },
    ]);
  });

  it("zero gifts → zero deduction, no carryforward", () => {
    const result = computeCharitableDeductionForYear(baseInput());
    expect(result.deductionThisYear).toBe(0);
    expect(result.carryforwardOut.cashPublic).toEqual([]);
  });
});
