// src/lib/whatif/caps.ts
//
// Every wait, cap, weight and budget the what-if tools use, in one place.
//
// Measured 2026-10-14 on a dev household (28 accounts, 2026–2070), on a laptop:
// deterministic projection 0.06 s, Monte Carlo 1,000 trials 5.2 s, max-spending
// solve 15–16 s. Vercel is expected 2–3× slower. Task 14 re-times on Vercel and
// adjusts the variation caps here.
import type { SolveFor } from "./changes";

/** How long a tool waits for a job before handing back a jobId. Under ~60 s, where MCP clients often stop waiting. */
export const INLINE_WAIT_MS = 45_000;
/** How long one get_what_if_results call waits for a running job. */
export const POLL_WAIT_MS = 50_000;
export const POLL_INTERVAL_MS = 2_000;
/** A job stops starting new variations after this; the MCP route's maxDuration is 800 s. */
export const JOB_BUDGET_MS = 700_000;
/** How long a what-if job's state stays in Redis. */
export const JOB_TTL_SECONDS = 24 * 60 * 60;
/** A job still "running" after this is reported as failed. Longer than the MCP route's 800 s maxDuration, so a live job is never reaped. */
export const STALE_JOB_MS = 15 * 60 * 1000;

export const MAX_VARIANTS_DETERMINISTIC = 25;
export const MAX_VARIANTS_HEAVY = 10;
export const MAX_CHANGES = 40;
/** Compute-limit units for a variation with Monte Carlo or a success-based solve (a deterministic one costs 1). */
export const HEAVY_WEIGHT = 4;

export function isHeavy(solveFor: SolveFor | null | undefined, includeMonteCarlo: boolean): boolean {
  return includeMonteCarlo || (solveFor != null && solveFor.kind !== "ss_claim_age");
}

/** Units charged against the compute rate limit: one per variation, more when heavy, plus the baseline. */
export function computeWeight(
  variants: ReadonlyArray<{ solveFor?: SolveFor | null }>,
  includeMonteCarlo: boolean,
): number {
  return variants.reduce((w, v) => w + (isHeavy(v.solveFor, includeMonteCarlo) ? HEAVY_WEIGHT : 1), 1);
}

export function variantCap(heavy: boolean): number {
  return heavy ? MAX_VARIANTS_HEAVY : MAX_VARIANTS_DETERMINISTIC;
}
