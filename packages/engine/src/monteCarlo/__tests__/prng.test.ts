import { describe, it, expect } from "vitest";
import { createRng, splitSeed } from "../prng";

describe("createRng (Mulberry32)", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces a different sequence for a different seed", () => {
    const a = createRng(1);
    const b = createRng(2);
    // Overwhelmingly unlikely for the first 10 draws to all collide.
    const diverged = Array.from({ length: 10 }, () => a() !== b()).some(Boolean);
    expect(diverged).toBe(true);
  });

  it("always returns values in [0, 1)", () => {
    const rng = createRng(12345);
    for (let i = 0; i < 10_000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("has an empirical mean near 0.5 over 100k draws", () => {
    const rng = createRng(7);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) sum += rng();
    const mean = sum / n;
    // For uniform[0,1), SE of mean at n=100k is ~0.00091; 0.01 is ~11 SE — very safe.
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });

  it("accepts floating-point seeds (truncated internally to uint32)", () => {
    // Same integer seed via two different floats should produce identical output.
    const a = createRng(3.0);
    const b = createRng(3);
    expect(a()).toBe(b());
  });
});

describe("splitSeed", () => {
  it("produces deterministic sub-seeds from (seed, index)", () => {
    expect(splitSeed(42, 0)).toBe(splitSeed(42, 0));
    expect(splitSeed(42, 1)).toBe(splitSeed(42, 1));
  });

  it("produces different sub-seeds for different indices", () => {
    const s0 = splitSeed(42, 0);
    const s1 = splitSeed(42, 1);
    const s2 = splitSeed(42, 2);
    expect(s0).not.toBe(s1);
    expect(s1).not.toBe(s2);
    expect(s0).not.toBe(s2);
  });

  it("produces sub-seeds whose streams don't trivially collide", () => {
    // Using splitSeed to seed two streams should yield independent-looking output.
    const a = createRng(splitSeed(100, 0));
    const b = createRng(splitSeed(100, 1));
    // First draw of each stream should differ.
    expect(a()).not.toBe(b());
  });
});
