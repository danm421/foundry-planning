/**
 * Box–Muller N(0, 1) sampler built on top of a uniform PRNG.
 *
 * Each iteration of Box–Muller produces two independent standard-normal
 * variates from two uniform draws. We cache the paired variate between calls
 * so we don't discard half of the Gaussian output.
 */
export function createNormalSampler(uniform: () => number): () => number {
  let spare: number | null = null;
  return function next() {
    if (spare !== null) {
      const x = spare;
      spare = null;
      return x;
    }
    // Avoid u1 = 0 (log(0) = -∞). u1 from Mulberry32 is in [0, 1), so
    // substitute Number.MIN_VALUE on the (astronomically rare) zero draw.
    let u1 = uniform();
    if (u1 === 0) u1 = Number.MIN_VALUE;
    const u2 = uniform();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spare = mag * Math.sin(theta);
    return mag * Math.cos(theta);
  };
}
