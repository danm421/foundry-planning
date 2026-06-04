import { describe, it, expect } from "vitest";
import { stableStringify, hashMonteCarloInputs } from "./hash";
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
