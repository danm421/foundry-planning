// One definition of "this year" for planning: the calendar year in US Eastern.
// Server clocks run on UTC, where Jan 1 00:00 is still Dec 31 evening in the
// US, so the start-year switch, its save check, the January roll-forward cron
// and the loader's data year all read the year through here.
//
// Client-safe: validate-patch.ts ships in the browser bundle and imports this.

export const PLANNING_TIME_ZONE = "America/New_York";

const yearFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: PLANNING_TIME_ZONE,
  year: "numeric",
});

export function currentPlanningYear(now: Date = new Date()): number {
  return Number(yearFormat.format(now));
}

/** The Assumptions switch: on exactly when the plan starts next calendar year. */
export function startsNextYear(planStartYear: number, now: Date = new Date()): boolean {
  return planStartYear === currentPlanningYear(now) + 1;
}

/** The calendar year the entered data describes. Equal to the start year
 *  (no skipped year) unless the plan starts next year; a stale start year
 *  behind this year clamps to itself so nothing is rebased. */
export function planDataYear(planStartYear: number, now: Date = new Date()): number {
  return Math.min(currentPlanningYear(now), planStartYear);
}
