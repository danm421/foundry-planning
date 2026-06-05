// src/lib/solver/lever-search-config.ts
//
// Per-lever search-range / step / direction config used by the goal-seek
// solver. Pure (no DB, no engine — just reads from a ClientData tree).

import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "./types";
import type { SolveLeverKey } from "./solve-types";

export const SAVINGS_HARD_CAP = 100_000;
export const ROTH_AMOUNT_HARD_CAP = 1_000_000;
export const SAVINGS_ZERO_DEFAULT_HI = 50_000;
export const SAVINGS_SOURCE_MULTIPLIER = 4;

/** Upper bound for the living-expense-scale search: 10× the plan's stated
 *  retirement living spend. Effectively uncapped — no realistic plan sustains
 *  more than this — while keeping the bisection bracket finite (~12 iterations
 *  at the 0.01 step, well under WIDE_LEVER_MAX_ITERATIONS). */
export const MAX_LIVING_EXPENSE_SCALE = 10;

export interface LeverSearchConfig {
  lo: number;
  hi: number;
  step: number;
  /** +1 if increasing lever value increases PoS, -1 if decreasing. Used only
   *  for the "both endpoints beat target → return cheaper endpoint" case. */
  direction: 1 | -1;
  /** Optional bisect tolerance override (±PoS). Omitted ⟹ bisect default 0.02.
   *  Set to 0 for "maximize the lever" solves so the search collapses to the
   *  HIGHEST value that still beats the target instead of exiting early at the
   *  first midpoint within ±2% (which under-reports sustainable spending). */
  tolerance?: number;
}

export function leverSearchConfig(
  target: SolveLeverKey,
  tree: ClientData,
): LeverSearchConfig {
  switch (target.kind) {
    case "retirement-age":
      return { lo: 50, hi: 80, step: 1, direction: 1 };
    case "living-expense-scale":
      // Wide, effectively-uncapped range with tolerance:0 so the solver returns
      // the maximum sustainable spend, not the first scale within ±2% of target.
      return {
        lo: 0.5,
        hi: MAX_LIVING_EXPENSE_SCALE,
        step: 0.01,
        direction: -1,
        tolerance: 0,
      };
    case "ss-claim-age":
      return { lo: 62, hi: 70, step: 1, direction: 1 };
    case "savings-contribution": {
      const rule = tree.savingsRules.find((r) => r.accountId === target.accountId);
      if (rule?.fundFromExpenseReduction) {
        // Self-funding (analysis) rule: the feasible ceiling is roughly the
        // largest single year's living expense (all of which could be
        // redirected) plus working-year surplus headroom. Use the max living
        // expense as a robust upper bound, with a hard cap.
        const maxLiving = tree.expenses
          .filter((e) => e.type === "living")
          .reduce((m, e) => Math.max(m, e.annualAmount), 0);
        const hi = Math.min(
          SAVINGS_HARD_CAP,
          Math.max(SAVINGS_ZERO_DEFAULT_HI, maxLiving * 1.5),
        );
        return { lo: 0, hi, step: 1000, direction: 1 };
      }
      const source = rule?.annualAmount ?? 0;
      const hi =
        source === 0
          ? SAVINGS_ZERO_DEFAULT_HI
          : Math.min(SAVINGS_HARD_CAP, source * SAVINGS_SOURCE_MULTIPLIER);
      return { lo: 0, hi, step: 1000, direction: 1 };
    }
    case "roth-conversion-amount": {
      const rc = (tree.rothConversions ?? []).find(
        (r) => r.id === target.techniqueId,
      );
      const current = rc?.fixedAmount ?? 0;
      const hi =
        current === 0
          ? 200_000
          : Math.min(ROTH_AMOUNT_HARD_CAP, current * 4);
      // roth-conversion-amount: more conversion → higher long-run PoS (reduces
      // future taxable RMDs), so the lever is positively directional and lo: 0
      // is the cheaper endpoint when both ends already beat target. `direction`
      // only gates bisect's both-beat shortcut, so this is the whole fix for
      // F2/F9/F12/F10 — no per-lever flag needed.
      return { lo: 0, hi, step: 1000, direction: 1 };
    }
  }
}

/** Build a SolverMutation for a candidate value at the targeted lever. */
export function buildLeverMutation(
  target: SolveLeverKey,
  value: number,
  tree: ClientData,
): SolverMutation {
  switch (target.kind) {
    case "retirement-age":
      return { kind: "retirement-age", person: target.person, age: value };
    case "living-expense-scale":
      return { kind: "living-expense-scale", multiplier: value };
    case "ss-claim-age":
      return { kind: "ss-claim-age", person: target.person, age: value };
    case "savings-contribution":
      return {
        kind: "savings-contribution",
        accountId: target.accountId,
        annualAmount: value,
      };
    case "roth-conversion-amount": {
      const rc = (tree.rothConversions ?? []).find(
        (r) => r.id === target.techniqueId,
      );
      if (!rc) {
        throw new Error(
          `roth-conversion-amount solve: no conversion ${target.techniqueId}`,
        );
      }
      return {
        kind: "roth-conversion-upsert",
        id: rc.id,
        value: { ...rc, fixedAmount: value },
      };
    }
  }
}
