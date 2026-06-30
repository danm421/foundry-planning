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
  /** Optional bisect selection override. Omitted ⟹ bisect default "beat-target".
   *  Set to "closest" for the living-expense solve so the result snaps to the
   *  step whose PoS is nearest the target — even when that step is slightly below
   *  it — rather than always rounding down to the last step that beats target. */
  selection?: "beat-target" | "closest";
}

export function leverSearchConfig(
  target: SolveLeverKey,
  tree: ClientData,
): LeverSearchConfig {
  switch (target.kind) {
    case "retirement-age":
      return { lo: 50, hi: 80, step: 1, direction: 1 };
    case "living-expense-scale":
      // Absolute-dollar search over annual retirement living spend, on a $5,000
      // grid. tolerance:0 + selection:"closest" so the solve collapses the
      // bracket fully and then returns the $5k step whose PoS is NEAREST the
      // target — even if it lands slightly below it — instead of always rounding
      // down to the last step that still beats target. direction -1 because more
      // spending lowers PoS. Interpolation makes the wide range cheap.
      return {
        lo: 0,
        hi: livingExpenseSearchCeiling(tree),
        step: 5000,
        direction: -1,
        tolerance: 0,
        selection: "closest",
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

/** Upper bound for the absolute-dollar living-expense search. A generous,
 *  resource-aware estimate — it only needs to comfortably exceed the answer,
 *  since interpolation homes in regardless of how wide the bracket is. Clamped
 *  to [300k, 3M]. */
export function livingExpenseSearchCeiling(tree: ClientData): number {
  const living = tree.expenses
    .filter((e) => e.type === "living")
    .reduce((s, e) => s + e.annualAmount, 0);
  const income = tree.incomes.reduce((s, i) => s + i.annualAmount, 0);
  const assets = tree.accounts.reduce((s, a) => s + (a.value ?? 0), 0);
  const estimate = Math.max(living * 3, income + 0.1 * assets, 300_000);
  return Math.min(3_000_000, estimate); // estimate already ≥ 300k via the max above
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
      // Lever key stays "living-expense-scale" for API stability; the search runs
      // in dollars and emits a living-expense-amount mutation.
      return { kind: "living-expense-amount", amount: value };
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
