// The ladder's rungs: what "save more" means as a number, and what moving to a
// rung means as a change to the plan.
//
// Pure — no engine, no DB. The registry reaches this file from a "use client"
// launcher component, so it may only ever import TYPES from the engine/solver.

import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { deferralAccounts } from "../early-years-standing/deferral-rules";

export type RungConfig =
  | { mode: "relative"; offsets: number[] }
  | { mode: "absolute"; percents: number[] };

export interface Rung {
  /** Fraction of salary, 0–1. */
  percent: number;
  label: string;
  /** True when this rung is what the client already does — the honest baseline. */
  isCurrent: boolean;
}

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * The household's real payroll deferral rate: the SUM of every active rule's
 * percent, not the first account's.
 *
 * It has to be the sum. The ladder's first rung is "what you save now", and a
 * client deferring 6% into a 401(k) and 4% into a 457 saves 10% — reading one
 * account would draw their own bar 4 points short of the truth.
 */
export function householdCurrentPercent(data: ClientData): number {
  const year = data.planSettings.planStartYear;
  const total = deferralAccounts(data, year).reduce((sum, a) => sum + a.currentPercent, 0);
  return clamp01(total);
}

export function resolveRungs(config: RungConfig, currentPercent: number): Rung[] {
  const percents =
    config.mode === "relative"
      ? config.offsets.map((o) => currentPercent + o)
      : config.percents;
  return percents.map((raw) => {
    // R11 — `applyMutations` does not validate its input, so an unclamped rung
    // would run the projection at a >100% deferral and print the result.
    const percent = clamp01(raw);
    return {
      percent,
      label: `Save ${pct(percent)}`,
      isCurrent: Math.abs(percent - currentPercent) < 1e-9,
    };
  });
}

/**
 * The plan change that puts the household at `targetPercent`.
 *
 * The whole delta lands on ONE account — the largest single-rule deferral —
 * rather than being spread or applied to every account:
 *
 * - Setting every account to the rung would multiply the household's rate by
 *   the number of accounts, so a 10% saver asked for 11% would end up at 22%.
 * - `applyMutations` sets `savings-annual-percent` on EVERY rule sharing the
 *   account id, so an account fed by two rules would defer twice the target.
 *   Those accounts are left untouched (their contribution still shows in the
 *   base bars); when none is movable there is no honest mutation to make and
 *   the caller renders the page's empty state.
 * - A rung that equals the current rate returns NOTHING, so rung 0 re-runs the
 *   base plan unchanged and the "what you save now" bar is what they save now.
 *
 * Known limit: a DOWNWARD rung larger than the target account's own percent
 * clamps at 0, so the household lands above the requested rate. Only reachable
 * in absolute mode on a multi-account household.
 */
export function ladderMutations(source: ClientData, targetPercent: number): SolverMutation[] {
  const delta = clamp01(targetPercent) - householdCurrentPercent(source);
  if (Math.abs(delta) < 1e-9) return [];

  const movable = deferralAccounts(source, source.planSettings.planStartYear)
    .filter((a) => a.ruleCount === 1);
  if (movable.length === 0) return [];

  const target = movable.reduce((best, a) => (a.currentPercent > best.currentPercent ? a : best));
  return [
    {
      kind: "savings-annual-percent",
      accountId: target.accountId,
      percent: clamp01(target.currentPercent + delta),
    },
  ];
}

/** How many deferral accounts the ladder can actually move. Zero means every
 *  rung would re-run the same plan, and the page must say so instead of drawing
 *  three identical bars under three different labels. */
export function movableAccountCount(data: ClientData): number {
  return deferralAccounts(data, data.planSettings.planStartYear)
    .filter((a) => a.ruleCount === 1).length;
}
