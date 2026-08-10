import { describe, it, expect } from "vitest";
import { allocateCharBudget } from "../budget";

describe("allocateCharBudget", () => {
  it("gives everyone what they need when the total fits", () => {
    expect(allocateCharBudget([100, 200], 1000)).toEqual([100, 200]);
  });

  it("redistributes what a small document does not use to the large one", () => {
    // Equal share is 500 each. The 100-char doc uses 100; the other gets 900.
    expect(allocateCharBudget([100, 5000], 1000)).toEqual([100, 900]);
  });

  it("splits evenly when every document is over its share", () => {
    expect(allocateCharBudget([5000, 5000], 1000)).toEqual([500, 500]);
  });

  it("keeps a two-page 8283 fully readable next to a 200-page 1040", () => {
    // The whole point: the small supporting document is where the second read
    // earns its keep, and a naive head-of-concatenation cap would cut it off
    // entirely.
    const [eightTwoEightThree, tenForty] = allocateCharBudget([3_000, 400_000], 120_000);
    expect(eightTwoEightThree).toBe(3_000);
    expect(tenForty).toBe(117_000);
  });

  it("returns an empty allocation for no documents", () => {
    expect(allocateCharBudget([], 1000)).toEqual([]);
  });
});
