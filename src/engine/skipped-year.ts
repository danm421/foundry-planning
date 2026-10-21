// "Start the plan next year": when planSettings.dataYear < planStartYear, the
// window [dataYear, planStartYear) already happened. An amount entered during
// it is the first plan year's amount — a $200,000 salary entered in 2026 shows
// $200,000 in 2027 and grows from 2028.
//
// Every inflation site in the engine reads `inflationStartYear ?? startYear`
// (or `startYear` alone for rows with no inflation base), so one conversion at
// runProjection's entry covers them all. It is not done in the loader: the
// rebased years would leak into the edit forms and get saved.
import type { ClientData, PlanSettings } from "./types";

type SkipWindow = Pick<PlanSettings, "planStartYear" | "dataYear">;

function inSkippedYear(year: number, ps: SkipWindow): boolean {
  return ps.dataYear != null && year >= ps.dataYear && year < ps.planStartYear;
}

/** The year a row's amount compounds from. A base year inside the skipped
 *  window moves to the plan start; any other base year is returned unchanged. */
export function inflationBaseYear(baseYear: number, ps: SkipWindow): number {
  return inSkippedYear(baseYear, ps) ? ps.planStartYear : baseYear;
}

/** `data` with every row whose growth base falls in the skipped year rebased to
 *  the plan start. Returns the same object when nothing is skipped; never
 *  mutates its input. One-time rows are untouched — they simply never run. */
export function rebaseSkippedYearRows(data: ClientData): ClientData {
  const ps = data.planSettings;
  if (ps.dataYear == null || ps.dataYear >= ps.planStartYear) return data;
  const start = ps.planStartYear;

  const rebaseInflation = <T extends { startYear: number; inflationStartYear?: number }>(row: T): T =>
    inSkippedYear(row.inflationStartYear ?? row.startYear, ps) ? { ...row, inflationStartYear: start } : row;
  // Recurring rows that compound from startYear alone.
  const rebaseStart = <T extends { startYear: number }>(row: T): T =>
    inSkippedYear(row.startYear, ps) ? { ...row, startYear: start } : row;

  return {
    ...data,
    incomes: data.incomes.map(rebaseInflation),
    expenses: data.expenses.map(rebaseInflation),
    rothConversions: data.rothConversions?.map((c) =>
      c.conversionType === "fixed_amount" ? rebaseInflation(c) : c,
    ),
    taxAdjustments: data.taxAdjustments?.map(rebaseStart),
    deductions: data.deductions?.map(rebaseStart),
    transfers: data.transfers?.map((t) => (t.mode === "recurring" ? rebaseStart(t) : t)),
  };
}
