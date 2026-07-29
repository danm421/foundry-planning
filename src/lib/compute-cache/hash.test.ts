import { describe, it, expect, vi } from "vitest";
import {
  stableStringify,
  hashMonteCarloInputs,
  hashMaxSpendingInputs,
  hashRiskCapacityInputs,
} from "./hash";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { ClientData } from "@/engine/types";

const tree = { client: { id: "c1" }, accounts: [{ id: "a", value: 100 }] } as unknown as ClientData;
const mc: MonteCarloPayload = {
  indices: [{ id: "eq", arithMean: 0.07, stdDev: 0.15 }],
  correlation: [[1]],
  accountMixes: [{ accountId: "a", mix: [{ assetClassId: "eq", weight: 1 }] }] as never,
  startingLiquidBalance: 100,
  seed: 42,
  requiredMinimumAssetLevel: 0,
};

describe("stableStringify", () => {
  it("is insensitive to key order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
  it("neutralizes float representation noise via rounding", () => {
    expect(stableStringify({ x: 0.1 + 0.2 })).toBe(stableStringify({ x: 0.3 }));
  });
});

describe("hashMonteCarloInputs", () => {
  it("is stable for identical inputs", () => {
    expect(hashMonteCarloInputs({ tree, mcPayload: mc, trials: 1000 })).toBe(
      hashMonteCarloInputs({ tree, mcPayload: mc, trials: 1000 }),
    );
  });
  it("changes when the seed changes", () => {
    const a = hashMonteCarloInputs({ tree, mcPayload: mc, trials: 1000 });
    const b = hashMonteCarloInputs({ tree, mcPayload: { ...mc, seed: 43 }, trials: 1000 });
    expect(a).not.toBe(b);
  });
  it("changes when the trial count changes", () => {
    const a = hashMonteCarloInputs({ tree, mcPayload: mc, trials: 1000 });
    const b = hashMonteCarloInputs({ tree, mcPayload: mc, trials: 250 });
    expect(a).not.toBe(b);
  });
  it("changes when a tree field changes", () => {
    const a = hashMonteCarloInputs({ tree, mcPayload: mc, trials: 1000 });
    const t2 = { ...tree, accounts: [{ id: "a", value: 200 }] } as unknown as ClientData;
    const b = hashMonteCarloInputs({ tree: t2, mcPayload: mc, trials: 1000 });
    expect(a).not.toBe(b);
  });
});

describe("hashMaxSpendingInputs", () => {
  it("is stable for identical inputs and varies with target", () => {
    const a = hashMaxSpendingInputs({ tree, mcPayload: mc, targetPoS: 0.85 });
    const b = hashMaxSpendingInputs({ tree, mcPayload: mc, targetPoS: 0.85 });
    const c = hashMaxSpendingInputs({ tree, mcPayload: mc, targetPoS: 0.80 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("hashRiskCapacityInputs", () => {
  const bounds = { cashReturn: 0.03, equityReturn: 0.08 };

  it("is stable for identical inputs", () => {
    expect(hashRiskCapacityInputs({ tree, ...bounds })).toBe(
      hashRiskCapacityInputs({ tree, ...bounds }),
    );
  });

  it("changes when the CMA return bounds change", () => {
    const a = hashRiskCapacityInputs({ tree, ...bounds });
    const b = hashRiskCapacityInputs({ tree, ...bounds, equityReturn: 0.09 });
    expect(a).not.toBe(b);
  });

  // Capacity's age input is `projection[0].ages.client`, which the engine
  // computes as `planStartYear - clientBirthYear` (projection.ts: the year loop
  // opens at `planSettings.planStartYear`). Both operands are PERSISTED on the
  // tree, so the age this hash has to track is already covered by hashing the
  // tree -- there is deliberately no wall-clock component here.
  //
  // This pins the "no date component" decision as intentional. Do NOT fold
  // `new Date().getFullYear()` in to "keep capacity fresh": nothing about
  // capacity moves with the calendar, so a wall-clock term would discard every
  // household's cached capacity once a year and re-run a full projection per
  // household to reproduce a byte-identical result. If capacity ever gains a
  // genuine wall-clock input, hash that input -- not the current year.
  it("changes when planStartYear changes, so age is covered without a date term", () => {
    const at2026 = {
      ...tree,
      planSettings: { planStartYear: 2026, planEndYear: 2070 },
    } as unknown as ClientData;
    const at2027 = {
      ...tree,
      planSettings: { planStartYear: 2027, planEndYear: 2070 },
    } as unknown as ClientData;
    expect(hashRiskCapacityInputs({ tree: at2026, ...bounds })).not.toBe(
      hashRiskCapacityInputs({ tree: at2027, ...bounds }),
    );
  });

  it("does not vary with wall-clock time", () => {
    const before = hashRiskCapacityInputs({ tree, ...bounds });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
      expect(hashRiskCapacityInputs({ tree, ...bounds })).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
