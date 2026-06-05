// src/lib/solver/eval-cache.ts
//
// Tiny value-keyed async memo for solver evaluations. The solver re-proposes
// candidate values (e.g. the final re-eval at the solved value, or a
// re-interpolated probe), and each evaluation runs a Monte Carlo simulation.
// Caching by exact candidate value skips the duplicate MC run.

export function memoizeByValue<T>(
  compute: (value: number) => Promise<T>,
): (value: number) => Promise<T> {
  const cache = new Map<number, T>();
  return async (value: number): Promise<T> => {
    const hit = cache.get(value);
    if (hit !== undefined) return hit;
    const result = await compute(value);
    cache.set(value, result);
    return result;
  };
}
