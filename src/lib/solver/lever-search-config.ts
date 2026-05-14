// src/lib/solver/lever-search-config.ts
//
// Per-lever search-range / step / direction config used by the goal-seek
// solver. Pure (no DB, no engine — just reads from a ClientData tree).

import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "./types";
import type { SolveLeverKey } from "./solve-types";

export const SAVINGS_HARD_CAP = 100_000;
export const SAVINGS_ZERO_DEFAULT_HI = 50_000;
export const SAVINGS_SOURCE_MULTIPLIER = 4;

export interface LeverSearchConfig {
  lo: number;
  hi: number;
  step: number;
  /** +1 if increasing lever value increases PoS, -1 if decreasing. Used only
   *  for the "both endpoints beat target → return cheaper endpoint" case. */
  direction: 1 | -1;
}

export function leverSearchConfig(
  target: SolveLeverKey,
  tree: ClientData,
): LeverSearchConfig {
  switch (target.kind) {
    case "retirement-age":
      return { lo: 50, hi: 80, step: 1, direction: 1 };
    case "living-expense-scale":
      return { lo: 0.5, hi: 1.5, step: 0.01, direction: -1 };
    case "ss-claim-age":
      return { lo: 62, hi: 70, step: 1, direction: 1 };
    case "savings-contribution": {
      const rule = tree.savingsRules.find((r) => r.accountId === target.accountId);
      const source = rule?.annualAmount ?? 0;
      const hi =
        source === 0
          ? SAVINGS_ZERO_DEFAULT_HI
          : Math.min(SAVINGS_HARD_CAP, source * SAVINGS_SOURCE_MULTIPLIER);
      return { lo: 0, hi, step: 1000, direction: 1 };
    }
  }
}

/** Build a SolverMutation for a candidate value at the targeted lever. */
export function buildLeverMutation(
  target: SolveLeverKey,
  value: number,
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
  }
}
