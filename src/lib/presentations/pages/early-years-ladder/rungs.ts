// The ladder's rungs: what "save more" means as a number, and what moving to a
// rung means as a change to the plan.
//
// Pure — no engine value imports beyond the leaf ownership helper
// `deferral-rules.ts` reaches for, no DB. The registry reaches this file from a
// "use client" launcher component.

import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import {
  deferralAccounts,
  householdSalary,
  isMovable,
} from "../early-years-standing/deferral-rules";

export type RungConfig =
  | { mode: "relative"; offsets: number[] }
  | { mode: "absolute"; percents: number[] };

export interface Rung {
  /** Fraction of HOUSEHOLD salary, 0–1 — the same quantity the standing sheet
   *  prints, so the two pages never state one rate two ways. */
  percent: number;
  label: string;
  /** True when this rung is what the client already does — the honest baseline. */
  isCurrent: boolean;
}

/** Why the ladder cannot be drawn for a plan. */
export type LadderBlocker = "no-deferral" | "at-annual-maximum" | "not-modellable";

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const pct = (p: number) => `${Math.round(p * 100)}%`;

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
 * The plan change that puts the household at `targetPercent`, given the rate
 * `currentPercent` the plan runs at today.
 *
 * Both percents are shares of HOUSEHOLD salary — the quantity both Early Years
 * sheets print. The engine resolves `annualPercent` against the ACCOUNT
 * OWNER's slice, so the delta is re-based onto that owner's pay before it is
 * written. Without the conversion a +3pp rung on a spouse earning a third of
 * the household income delivers a third of the step, and the bar carries a
 * rate the plan never runs at.
 *
 * The whole delta lands on ONE account — the single-rule deferral holding the
 * most dollars — rather than being spread or applied to every account:
 *
 * - Setting every account to the rung would multiply the household's rate by
 *   the number of accounts.
 * - `applyMutations` sets `savings-annual-percent` on EVERY rule sharing the
 *   account id, so an account fed by two rules would defer twice the target.
 *   Unmovable accounts are left untouched (their contribution still shows in
 *   the base bars); when none is movable there is no honest mutation to make
 *   and the caller renders the page's empty state.
 * - A rung that equals the current rate returns NOTHING, so rung 0 re-runs the
 *   base plan unchanged and the "what you save now" bar is what they save now.
 *
 * Known limit: a DOWNWARD rung larger than the target account's own share
 * clamps at 0, so the household lands above the requested rate. Only reachable
 * in absolute mode on a multi-account household.
 */
export function ladderMutations(
  source: ClientData,
  targetPercent: number,
  currentPercent: number,
): SolverMutation[] {
  const delta = clamp01(targetPercent) - currentPercent;
  if (Math.abs(delta) < 1e-9) return [];

  const year = source.planSettings.planStartYear;
  const movable = deferralAccounts(source, year).filter(isMovable);
  if (movable.length === 0) return [];

  // "Largest" in DOLLARS, not in percent: each percent is measured against its
  // own owner's pay, so 10% of a $160k salary is a smaller contribution than
  // 6% of a $345k one.
  const dollars = (a: { currentPercent: number; ownerSalary: number }) =>
    a.currentPercent * a.ownerSalary;
  const target = movable.reduce((best, a) => (dollars(a) > dollars(best) ? a : best));

  const extraOnOwner = (delta * householdSalary(source, year)) / target.ownerSalary;
  return [
    {
      kind: "savings-annual-percent",
      accountId: target.accountId,
      percent: clamp01(target.currentPercent + extraOnOwner),
    },
  ];
}

/**
 * Why this plan has no ladder, or null when it has one.
 *
 * Three different reasons, because they need three different sentences. An
 * empty state reading "this plan has no payroll retirement contributions" onto
 * a client who maxes theirs out contradicts the sheet immediately before it,
 * which has just reported those very dollars.
 */
export function ladderBlocker(data: ClientData): LadderBlocker | null {
  const accounts = deferralAccounts(data, data.planSettings.planStartYear);
  if (accounts.length === 0) return "no-deferral";
  if (accounts.some(isMovable)) return null;
  return accounts.every((a) => a.contributesMax) ? "at-annual-maximum" : "not-modellable";
}
