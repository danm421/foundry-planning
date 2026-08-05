// src/lib/intake/income-years.ts
//
// Turns an intake income's client-facing year fields into the three columns the
// `incomes` row actually stores: `startYear`, `endYear`, `endYearRef`.
//
// The "Retirement" checkbox is why this isn't a straight copy. Rather than
// freezing a year, a retirement-ending row is anchored with an `endYearRef`
// milestone, so when the advisor later moves the retirement age the row follows
// — `resolveRefYears` (src/lib/year-refs.ts) re-derives `endYear` on every load.
// The year written here is what that resolver will compute, because it comes
// from the same `resolveMilestone` call: an end-positioned transition ref lands
// on the year *before* the milestone, so a salary's last year is the year
// before retirement.
//
// Pure and DB-free on purpose — `milestones.ts` is a zero-import leaf and the
// only value-level dependency here, so this module is safe to pull into the
// client bundle (the wizard's collapsed row uses `incomeSpanLabel`).

import {
  resolveMilestone,
  type ClientMilestones,
  type YearRef,
} from "@/lib/milestones";
import type { IntakePayload } from "./schema";

type IntakeIncome = IntakePayload["income"][number];

/** The retirement milestones an intake income can anchor its end to. */
type IncomeEndYearRef = Extract<YearRef, "client_retirement" | "spouse_retirement">;

/** Used whenever the form left a year blank — the pre-field behaviour. */
export interface YearFallbacks {
  currentYear: number;
  planEndYear: number;
}

interface IncomeYearWindow {
  startYear: number;
  endYear: number;
  /** Null for a fixed end year; a milestone when the row ends at retirement. */
  endYearRef: IncomeEndYearRef | null;
}

/**
 * Which retirement milestone a row ends at. Spouse-owned income follows the
 * spouse; client- and joint-owned income follows the primary. `spouseRetirement`
 * is only present when the household has a spouse with a retirement age on file
 * (`buildClientMilestones` leaves it undefined otherwise), so a spouse-owned row
 * in a single-person household falls back to the primary rather than anchoring
 * to a milestone that doesn't exist.
 */
function anchorFor(
  owner: IntakeIncome["owner"],
  milestones: ClientMilestones,
): IncomeEndYearRef {
  return owner === "spouse" && milestones.spouseRetirement != null
    ? "spouse_retirement"
    : "client_retirement";
}

export function incomeYearWindow(
  income: IntakeIncome,
  milestones: ClientMilestones,
  fallbacks: YearFallbacks,
): IncomeYearWindow {
  const startYear = income.startYear ?? fallbacks.currentYear;

  if (!income.endsAtRetirement) {
    return {
      startYear,
      endYear: income.endYear ?? fallbacks.planEndYear,
      endYearRef: null,
    };
  }

  const endYearRef = anchorFor(income.owner, milestones);
  return {
    startYear,
    endYear: resolveMilestone(endYearRef, milestones, "end") ?? fallbacks.planEndYear,
    endYearRef,
  };
}

/**
 * The inverse of `incomeYearWindow`: an existing `incomes` row expressed as the
 * form's fields, for prefilling. A row already anchored to a retirement
 * milestone comes back as the checkbox rather than as its resolved year, so
 * re-submitting a prefilled form preserves the anchor instead of freezing it.
 * Any other ref (`plan_end`, an SS claim age) has no control on this form and
 * round-trips as its plain year.
 *
 * Kept beside the forward mapping so the two can't drift apart.
 */
export function incomeFormYears(row: {
  startYear: number;
  endYear: number;
  endYearRef: string | null;
}): { startYear: number; endYear?: number; endsAtRetirement: boolean } {
  const endsAtRetirement =
    row.endYearRef === "client_retirement" || row.endYearRef === "spouse_retirement";
  return {
    startYear: row.startYear,
    endYear: endsAtRetirement ? undefined : row.endYear,
    endsAtRetirement,
  };
}

/**
 * How a row's span reads to a human: `"2026 – 2040"`, `"2026 – retirement"`,
 * `"2026 – plan end"`. Blank years render as the default `incomeYearWindow`
 * substitutes, so the wizard's collapsed row and the advisor's approve screen
 * both show what will actually be written.
 *
 * Takes the current year rather than reading the clock so it stays pure, and so
 * both callers can pass the same value apply does. Accepts the draft shape (all
 * fields optional) as well as a submitted row.
 */
export function incomeSpanLabel(
  income: { startYear?: number; endYear?: number; endsAtRetirement?: boolean },
  currentYear: number,
): string {
  const start = income.startYear ?? currentYear;
  const end = income.endsAtRetirement ? "retirement" : (income.endYear ?? "plan end");
  return `${start} – ${end}`;
}
