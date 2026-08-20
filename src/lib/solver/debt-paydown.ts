// src/lib/solver/debt-paydown.ts
//
// Pure helpers for the solver's Debt Paydown technique: a per-liability plan to
// throw extra principal at a loan — once, every month, or every year over a
// window — and see what it does to the payoff date and the interest bill.
//
// The technique does NOT introduce a new engine concept. It lowers to the
// `extraPayments` the engine already amortizes (see engine/liability-schedules.ts),
// which means the "never pay more than the loan" rule is enforced by the
// amortization schedule itself: computeAmortizationSchedule caps every extra at
// the remaining balance and stops emitting rows once the balance reaches zero.
// Everything here is about *expanding* a plan into those rows, *previewing* what
// the schedule does with them, and *trimming* the stored plan so it never claims
// years it can't spend.

import type { ExtraPayment, Liability } from "@/engine/types";
import type { SolverMutation } from "./types";
import { isHeldFlatLiability } from "@/engine/liability-kind";
import { buildLiabilitySchedule, scheduleRowAt } from "@/engine/liability-schedules";
import { usd } from "./technique-summaries";

export type DebtPaydownFrequency = "one_time" | "monthly" | "annual";

/** One loan's extra-principal plan. Identity is the liability — a loan carries
 *  at most one paydown, which is what makes the dialog a one-row-per-loan table. */
export interface DebtPaydownRow {
  liabilityId: string;
  frequency: DebtPaydownFrequency;
  /** Monthly extra (`monthly`), or the whole-year amount (`annual`, `one_time`). */
  amount: number;
  startYear: number;
  /** Inclusive. Always equals startYear for `one_time`. */
  endYear: number;
  /** Technique on/off, matching the other solver technique rows. Default on. */
  enabled?: boolean;
}

const PAYDOWN_ID_PREFIX = "solver-paydown";

function paydownExtraId(liabilityId: string, year: number): string {
  return `${PAYDOWN_ID_PREFIX}:${liabilityId}:${year}`;
}

/** True for an ExtraPayment this module generated (vs. one the advisor entered
 *  on the liability's Amortization tab). Lets the preview recover the untouched
 *  baseline from a working tree that already has the paydown applied. */
function isPaydownExtra(ep: { id: string }): boolean {
  return ep.id.startsWith(`${PAYDOWN_ID_PREFIX}:`);
}

/** The liability's own extra payments, with any solver paydown stripped out. */
export function baseExtraPayments(liability: Liability): ExtraPayment[] {
  return (liability.extraPayments ?? []).filter((ep) => !isPaydownExtra(ep));
}

/** A loan the technique can act on. Held-flat debt (credit cards, and any
 *  liability with no amortization term — e.g. an unlinked Plaid loan) has no
 *  schedule, so an extra payment against it would be silently discarded. */
export function isPaydownEligible(liability: Liability): boolean {
  return !isHeldFlatLiability(liability) && liability.balance > 0;
}

/** Expand a plan into the engine's per-year ExtraPayment rows. `monthly` maps to
 *  `per_payment` (applied after every scheduled payment); `annual` / `one_time`
 *  map to `lump_sum` (applied once in the year). */
function expandDebtPaydown(row: DebtPaydownRow): ExtraPayment[] {
  if (row.enabled === false || !(row.amount > 0)) return [];
  const lastYear = row.frequency === "one_time" ? row.startYear : row.endYear;
  if (lastYear < row.startYear) return [];
  const type = row.frequency === "monthly" ? "per_payment" : "lump_sum";
  const out: ExtraPayment[] = [];
  for (let year = row.startYear; year <= lastYear; year++) {
    out.push({
      id: paydownExtraId(row.liabilityId, year),
      liabilityId: row.liabilityId,
      year,
      type,
      amount: row.amount,
    });
  }
  return out;
}

/** The liability as the engine will see it once the paydown is applied. */
export function withDebtPaydown(
  liability: Liability,
  row: DebtPaydownRow | null,
): Liability {
  const base = baseExtraPayments(liability);
  return {
    ...liability,
    extraPayments: row ? [...base, ...expandDebtPaydown(row)] : base,
  };
}

/** Parse a loan's tagged extra payments back into the plan that produced them.
 *  Needed because a paydown saved into a scenario arrives on the working tree as
 *  expanded rows with no accompanying mutation — without this the Techniques tab
 *  would show nothing while the interest saving sat in every number. Returns
 *  null when the loan carries no solver paydown. */
export function readDebtPaydown(liability: Liability): DebtPaydownRow | null {
  const mine = (liability.extraPayments ?? [])
    .filter(isPaydownExtra)
    .sort((a, b) => a.year - b.year);
  if (mine.length === 0) return null;
  const [first] = mine;
  const last = mine[mine.length - 1];
  const frequency: DebtPaydownFrequency =
    first.type === "per_payment" ? "monthly" : mine.length === 1 ? "one_time" : "annual";
  return {
    liabilityId: liability.id,
    frequency,
    amount: first.amount,
    startYear: first.year,
    endYear: last.year,
  };
}

/** Every paydown in force, by liability id: what the tree already carries (from
 *  a sourced scenario), overlaid with this session's edits. Mirrors
 *  applyMutations' last-write-per-liability fold so the tab and the projection
 *  can never disagree about which paydowns are live. */
export function resolveDebtPaydowns(
  liabilities: Liability[],
  mutations: readonly SolverMutation[] = [],
): Map<string, DebtPaydownRow> {
  const out = new Map<string, DebtPaydownRow>();
  for (const liab of liabilities) {
    const stored = readDebtPaydown(liab);
    if (stored) out.set(liab.id, stored);
  }
  for (const m of mutations) {
    if (m.kind !== "debt-paydown") continue;
    if (m.value === null) out.delete(m.liabilityId);
    else out.set(m.liabilityId, m.value);
  }
  return out;
}

export interface DebtPaydownPreview {
  /** Year the last scheduled payment falls in, with and without the paydown.
   *  Null when the loan has no schedule at all. */
  basePayoffYear: number | null;
  newPayoffYear: number | null;
  yearsSaved: number;
  baseInterest: number;
  newInterest: number;
  interestSaved: number;
  /** What the plan asks for across its window. */
  requestedTotal: number;
  /** What the schedule actually spends — capped at the remaining balance and
   *  cut off at payoff. Marginal: the extra dollars this paydown adds on top of
   *  any extra payments already on the liability. */
  appliedTotal: number;
  /** appliedTotal < requestedTotal — the loan reaches zero before the window ends. */
  capped: boolean;
  /** Last year the paydown actually spends a dollar. */
  effectiveEndYear: number | null;
}

const sumExtra = (rows: { extraPayment: number }[]): number =>
  rows.reduce((s, r) => s + r.extraPayment, 0);
const sumInterest = (rows: { interest: number }[]): number =>
  rows.reduce((s, r) => s + r.interest, 0);
const payoffYearOf = (rows: { year: number }[]): number | null =>
  rows.length > 0 ? rows[rows.length - 1].year : null;

/** Total the plan asks for, ignoring the balance. Recurring windows assume a
 *  full 12 payments a year — a paydown always starts in a plan year, well after
 *  the loan's own (possibly partial) origination year. */
export function requestedPaydownTotal(row: DebtPaydownRow): number {
  if (!(row.amount > 0) || row.enabled === false) return 0;
  switch (row.frequency) {
    case "one_time":
      return row.amount;
    case "annual":
      return row.amount * Math.max(0, row.endYear - row.startYear + 1);
    case "monthly":
      return row.amount * 12 * Math.max(0, row.endYear - row.startYear + 1);
  }
}

export function previewDebtPaydown(
  liability: Liability,
  row: DebtPaydownRow | null,
): DebtPaydownPreview {
  const baseLiability = withDebtPaydown(liability, null);
  const baseSchedule = isHeldFlatLiability(baseLiability)
    ? []
    : buildLiabilitySchedule(baseLiability);
  const nextSchedule =
    row && !isHeldFlatLiability(baseLiability)
      ? buildLiabilitySchedule(withDebtPaydown(liability, row))
      : baseSchedule;

  const basePayoffYear = payoffYearOf(baseSchedule);
  const newPayoffYear = payoffYearOf(nextSchedule);
  const baseInterest = sumInterest(baseSchedule);
  const newInterest = sumInterest(nextSchedule);
  const requestedTotal = row ? requestedPaydownTotal(row) : 0;
  const appliedTotal = Math.max(0, sumExtra(nextSchedule) - sumExtra(baseSchedule));

  // The window can outlive the loan; the schedule simply stops. Report the last
  // year the paydown can actually spend so the UI (and the stored plan) tell the
  // truth about when it ends.
  const effectiveEndYear =
    row && newPayoffYear != null
      ? Math.min(row.frequency === "one_time" ? row.startYear : row.endYear, newPayoffYear)
      : null;

  return {
    basePayoffYear,
    newPayoffYear,
    yearsSaved:
      basePayoffYear != null && newPayoffYear != null
        ? Math.max(0, basePayoffYear - newPayoffYear)
        : 0,
    baseInterest,
    newInterest,
    interestSaved: Math.max(0, baseInterest - newInterest),
    requestedTotal,
    appliedTotal,
    capped: requestedTotal - appliedTotal > 0.5,
    effectiveEndYear,
  };
}

/**
 * Trim a plan so it can never claim more than the loan can absorb:
 *   - a one-time payment is capped at the balance standing at the start of its year;
 *   - the window ends the year the loan reaches zero.
 * The schedule enforces both regardless — this keeps the *stored* plan honest so
 * the summary chip and a re-opened dialog say what will actually happen.
 */
export function normalizeDebtPaydownRow(
  liability: Liability,
  row: DebtPaydownRow,
): DebtPaydownRow {
  const clamped: DebtPaydownRow = {
    ...row,
    amount: Math.max(0, row.amount),
    endYear: row.frequency === "one_time" ? row.startYear : Math.max(row.startYear, row.endYear),
  };

  if (clamped.frequency === "one_time") {
    const schedule = buildLiabilitySchedule(withDebtPaydown(liability, null));
    const atStart = scheduleRowAt(schedule, clamped.startYear);
    if (atStart) clamped.amount = Math.min(clamped.amount, atStart.beginningBalance);
  }

  const { effectiveEndYear } = previewDebtPaydown(liability, clamped);
  if (effectiveEndYear != null && effectiveEndYear < clamped.endYear) {
    clamped.endYear = effectiveEndYear;
  }
  return clamped;
}

/** One-line chip under the technique row's loan name. */
export function summarizeDebtPaydown(
  row: DebtPaydownRow,
  preview: DebtPaydownPreview,
): string {
  const cadence =
    row.frequency === "one_time"
      ? `${usd(row.amount)} in ${row.startYear}`
      : row.frequency === "monthly"
        ? `${usd(row.amount)}/mo · ${row.startYear}–${row.endYear}`
        : `${usd(row.amount)}/yr · ${row.startYear}–${row.endYear}`;
  if (preview.newPayoffYear == null) return cadence;
  const saved = `saves ${usd(preview.interestSaved)}`;
  // A trimmed window already ends on the payoff year, so naming it again is noise.
  return preview.newPayoffYear === row.endYear
    ? `${cadence} · ${saved}`
    : `${cadence} · paid off ${preview.newPayoffYear} · ${saved}`;
}
