// src/lib/compute-cache/single-flight.ts
//
// In-process promise coalescing for expensive computes. When two requests for
// the SAME work land on one serverless instance concurrently (e.g. the solver's
// gauge fetch and its Monte Carlo report fetch firing in the same tick for the
// same working tree), we want ONE compute, not two competing for the CPU.
//
// Each 1000-trial Monte Carlo run is ~75s of single-threaded CPU; two of them
// time-slicing on one Fluid Compute instance roughly doubles the wall-clock the
// user waits. Coalescing on a stable key collapses the duplicate into a single
// run whose result both callers share. The DB cache still backs everything, so
// requests on different instances stay correct — they just don't get to share.
//
// Keys MUST already capture every input that changes the result (we key off the
// input hash, which folds in the tree, mix, seed, trials, and engine version).

const inflight = new Map<string, Promise<unknown>>();

/**
 * Run `fn` under `key`, or join the in-flight run if one already exists for that
 * key. The map entry is cleared once the promise settles (success or failure),
 * so a later request recomputes rather than replaying a stale/failed result.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const run = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run;
}

/** Test-only: number of computes currently in flight. */
export function inflightCount(): number {
  return inflight.size;
}
