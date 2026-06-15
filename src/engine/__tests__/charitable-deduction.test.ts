import { describe, it, expect } from "vitest";
import {
  computeCharitableDeductionForYear,
  computeCharitableNoItemize,
  type ComputeCharitableDeductionInput,
} from "../charitable-deduction";
import { emptyCharityCarryforward } from "../types";
import type { CarryforwardEntry } from "../types";

function sumCarryforward(entries: CarryforwardEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

function baseInput(over: Partial<ComputeCharitableDeductionInput> = {}): ComputeCharitableDeductionInput {
  return {
    giftsThisYear: [],
    agi: 1_000_000,
    carryforwardIn: emptyCharityCarryforward(),
    currentYear: 2026,
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

describe("computeCharitableDeductionForYear — carryforward consumption", () => {
  it("uses prior-year carryforward before current-year gift (FIFO)", () => {
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [{ amount: 100_000, bucket: "cashPublic" }],
        agi: 500_000,
        carryforwardIn: {
          cashPublic: [{ amount: 200_000, originYear: 2024 }],
          cashPrivate: [],
          appreciatedPublic: [],
          appreciatedPrivate: [],
        },
        currentYear: 2026,
      }),
    );
    // 60% × 500K = 300K capacity
    // Carryforward 200K consumed first, then 100K of this-year gift
    expect(result.deductionThisYear).toBe(300_000);
    expect(result.carryforwardOut.cashPublic).toEqual([]);
  });

  it("partial carryforward consumption preserves remaining FIFO order", () => {
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [],
        agi: 100_000,
        carryforwardIn: {
          cashPublic: [
            { amount: 100_000, originYear: 2024 },
            { amount: 50_000, originYear: 2025 },
          ],
          cashPrivate: [],
          appreciatedPublic: [],
          appreciatedPrivate: [],
        },
        currentYear: 2026,
      }),
    );
    // 60% × 100K = 60K capacity. Consumes 60K of the 2024 entry; 2024 has 40K left, 2025 untouched.
    expect(result.deductionThisYear).toBe(60_000);
    expect(result.carryforwardOut.cashPublic).toEqual([
      { amount: 40_000, originYear: 2024 },
      { amount: 50_000, originYear: 2025 },
    ]);
  });

  it("drops carryforward entries older than 5 years", () => {
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [],
        agi: 1_000_000,
        carryforwardIn: {
          cashPublic: [
            { amount: 100_000, originYear: 2020 }, // 6 years old → expired
            { amount: 100_000, originYear: 2021 }, // 5 years old → boundary, still valid
            { amount: 100_000, originYear: 2025 },
          ],
          cashPrivate: [],
          appreciatedPublic: [],
          appreciatedPrivate: [],
        },
        currentYear: 2026,
      }),
    );
    // 2020 entry expired before consumption. 2021 + 2025 entries fully consumed.
    expect(result.deductionThisYear).toBe(200_000);
    expect(result.carryforwardOut.cashPublic).toEqual([]);
  });
});

describe("computeCharitableDeductionForYear — overall §170(b) AGI ceiling across buckets", () => {
  it("cashPublic at the 60% ceiling crowds out a same-year appreciatedPublic gift", () => {
    // AGI 1M. 600K cash-to-public exhausts the overall 60% ceiling (600K).
    // The 300K appreciated-to-public gift gets ZERO deduction this year and
    // carries forward in full — the categories share the overall ceiling, they
    // are NOT each entitled to a fresh slice of full AGI.
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [
          { amount: 600_000, bucket: "cashPublic" },
          { amount: 300_000, bucket: "appreciatedPublic" },
        ],
        agi: 1_000_000,
        currentYear: 2026,
      }),
    );
    expect(result.deductionThisYear).toBe(600_000);
    expect(result.byBucket.cashPublic).toBe(600_000);
    expect(result.byBucket.appreciatedPublic).toBe(0);
    expect(result.carryforwardOut.appreciatedPublic).toEqual([
      { amount: 300_000, originYear: 2026 },
    ]);
  });

  it("four-bucket gifts never exceed the overall 60% AGI ceiling in one year", () => {
    // AGI 1M. Gifts: 600K cashPublic + 300K cashPrivate + 300K appreciatedPublic
    // + 200K appreciatedPrivate = 1.4M of gifts. With the bug, every bucket got a
    // fresh slice of AGI and the year deducted all 1.4M. The overall ceiling caps
    // the year's deduction at 60% × AGI = 600K; the remaining 800K carries forward.
    const result = computeCharitableDeductionForYear(
      baseInput({
        giftsThisYear: [
          { amount: 600_000, bucket: "cashPublic" },
          { amount: 300_000, bucket: "cashPrivate" },
          { amount: 300_000, bucket: "appreciatedPublic" },
          { amount: 200_000, bucket: "appreciatedPrivate" },
        ],
        agi: 1_000_000,
        currentYear: 2026,
      }),
    );
    expect(result.deductionThisYear).toBeLessThanOrEqual(600_000);
    expect(result.deductionThisYear).toBe(600_000);

    // 1.4M gifted − 600K deducted = 800K carried forward across the buckets.
    const carriedForward =
      sumCarryforward(result.carryforwardOut.cashPublic) +
      sumCarryforward(result.carryforwardOut.cashPrivate) +
      sumCarryforward(result.carryforwardOut.appreciatedPublic) +
      sumCarryforward(result.carryforwardOut.appreciatedPrivate);
    expect(carriedForward).toBe(800_000);
  });
});

describe("computeCharitableNoItemize — standard-deduction branch (F23)", () => {
  it("realizes zero deduction and appends this-year gifts to carryforward in full", () => {
    const result = computeCharitableNoItemize({
      giftsThisYear: [{ amount: 100_000, bucket: "cashPublic" }],
      carryforwardIn: emptyCharityCarryforward(),
      currentYear: 2026,
    });
    expect(result.deductionThisYear).toBe(0);
    // Gift is preserved in full for a future itemizing year — NOT consumed.
    expect(result.carryforwardOut.cashPublic).toEqual([
      { amount: 100_000, originYear: 2026 },
    ]);
  });

  it("zeros byBucket", () => {
    const result = computeCharitableNoItemize({
      giftsThisYear: [{ amount: 100_000, bucket: "cashPublic" }],
      carryforwardIn: emptyCharityCarryforward(),
      currentYear: 2026,
    });
    expect(result.byBucket.cashPublic).toBe(0);
  });

  it("does NOT consume prior carryforward — only decays expired entries and appends new gifts", () => {
    const result = computeCharitableNoItemize({
      giftsThisYear: [{ amount: 50_000, bucket: "cashPublic" }],
      carryforwardIn: {
        cashPublic: [
          { amount: 100_000, originYear: 2020 }, // 6 years old → expired, dropped
          { amount: 200_000, originYear: 2025 }, // valid → preserved untouched
        ],
        cashPrivate: [],
        appreciatedPublic: [],
        appreciatedPrivate: [],
      },
      currentYear: 2026,
    });
    expect(result.deductionThisYear).toBe(0);
    // 2020 entry decayed; 2025 entry preserved in full (NOT consumed); new gift appended.
    expect(result.carryforwardOut.cashPublic).toEqual([
      { amount: 200_000, originYear: 2025 },
      { amount: 50_000, originYear: 2026 },
    ]);
  });
});
