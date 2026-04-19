/**
 * Mulberry32 — a small, fast, seedable PRNG producing uniform [0, 1).
 *
 * State is a single uint32. Period is 2^32. Good enough for Monte Carlo
 * with trial counts in the low millions; not cryptographic.
 *
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically derive a sub-seed from (seed, index) using a splitmix-style
 * hash. Lets us create per-trial independent streams from one master seed without
 * consuming draws from the master stream.
 */
export function splitSeed(seed: number, index: number): number {
  let x = ((seed >>> 0) + Math.imul(index >>> 0, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}
