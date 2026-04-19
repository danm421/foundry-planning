import { describe, it, expect } from "vitest";
import { createNormalSampler } from "../normal";
import { createRng } from "../prng";

describe("createNormalSampler (Box–Muller)", () => {
  it("is deterministic given the same underlying PRNG seed", () => {
    const a = createNormalSampler(createRng(42));
    const b = createNormalSampler(createRng(42));
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces finite numbers", () => {
    const sample = createNormalSampler(createRng(1));
    for (let i = 0; i < 10_000; i++) {
      const x = sample();
      expect(Number.isFinite(x)).toBe(true);
    }
  });

  it("has an empirical mean near 0 over 100k draws", () => {
    const sample = createNormalSampler(createRng(3));
    const n = 100_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sample();
    const mean = sum / n;
    // SE of mean for N(0,1) at n=100k is ~0.00316; 0.02 is ~6 SE — safe.
    expect(Math.abs(mean)).toBeLessThan(0.02);
  });

  it("has an empirical stdev near 1 over 100k draws", () => {
    const sample = createNormalSampler(createRng(5));
    const n = 100_000;
    const xs: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = sample();
      xs.push(x);
      sum += x;
    }
    const mean = sum / n;
    let sqErr = 0;
    for (const x of xs) sqErr += (x - mean) * (x - mean);
    const stdev = Math.sqrt(sqErr / (n - 1));
    expect(stdev).toBeGreaterThan(0.98);
    expect(stdev).toBeLessThan(1.02);
  });

  it("produces roughly symmetric tails (count < -2 vs count > 2)", () => {
    const sample = createNormalSampler(createRng(9));
    const n = 100_000;
    let lower = 0;
    let upper = 0;
    for (let i = 0; i < n; i++) {
      const x = sample();
      if (x < -2) lower++;
      if (x > 2) upper++;
    }
    // Expected tail mass ~2.28% each side → ~2280 each. Allow ±30%.
    expect(lower).toBeGreaterThan(1600);
    expect(lower).toBeLessThan(3000);
    expect(upper).toBeGreaterThan(1600);
    expect(upper).toBeLessThan(3000);
  });
});
