// src/lib/notifications/scan/birthdays.ts
//
// Cadence firing rules, forward windows, and birthday occurrence matching.
// Pure — every function here is total, takes `today` as an argument rather than
// reading the clock, and does all Date arithmetic in UTC. Local-time arithmetic
// would shift every window by a day for anyone west of UTC and make the cron's
// output depend on where it happens to run.
import type { DateDigestCadence } from "../catalog";

/** Inclusive ISO date range, `YYYY-MM-DD`, compared lexically. */
export type CadenceWindow = { from: string; to: string };

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Does this advisor's cadence produce a digest on `today`? */
export function shouldFireOn(cadence: DateDigestCadence, today: Date): boolean {
  if (cadence === "daily") return true;
  if (cadence === "weekly") return today.getUTCDay() === 1; // Monday
  return today.getUTCDate() === 1; // monthly: the 1st
}

/**
 * The window a firing produces. Always FORWARD from `today` — a birthday you
 * are told about the day after is worse than useless.
 */
export function cadenceWindow(cadence: DateDigestCadence, today: Date): CadenceWindow {
  const from = toISODate(today);
  if (cadence === "daily") return { from, to: from };
  if (cadence === "weekly") {
    const end = new Date(today.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    return { from, to: toISODate(end) };
  }
  // Day 0 of next month is the last day of this one — correct for 28/29/30/31
  // without a month-length table.
  const last = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
  );
  return { from, to: toISODate(last) };
}

/**
 * The date this person's birthday falls on inside `window`, or null.
 *
 * Iterates the window's year(s) rather than assuming one: a weekly window
 * opened on Dec 28 and every monthly window opened in December run into the
 * next year, and a same-year-only implementation silently drops every January
 * birthday for those advisors.
 */
export function occurrenceInWindow(
  dateOfBirth: string,
  window: CadenceWindow,
): string | null {
  const mm = dateOfBirth.slice(5, 7);
  const dd = dateOfBirth.slice(8, 10);
  const fromYear = Number(window.from.slice(0, 4));
  const toYear = Number(window.to.slice(0, 4));

  for (let y = fromYear; y <= toYear; y++) {
    // A Feb-29 birthday has no date in three years out of four. Observing it on
    // Feb 28 is the common convention and keeps those clients from vanishing
    // from the digest entirely; without this the candidate string "2026-02-29"
    // also compares as a plausible date and would silently never match.
    const candidate =
      mm === "02" && dd === "29" && !isLeapYear(y)
        ? `${y}-02-28`
        : `${y}-${mm}-${dd}`;
    if (candidate >= window.from && candidate <= window.to) return candidate;
  }
  return null;
}

export function ageTurning(dateOfBirth: string, occurrenceDate: string): number {
  return Number(occurrenceDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
}

/**
 * Idempotency key for the partial unique index on (user_id, dedup_key).
 *
 * Deliberately keyed on the OCCURRENCE, not the run: overlapping cadence
 * windows (a weekly Mon-Sun window and the monthly window that follows it) can
 * both contain the same birthday, and a re-run of the cron produces the same
 * window again. Both cases collapse to one row.
 */
export function birthdayDedupKey(contactId: string, occurrenceDate: string): string {
  return `birthday:${contactId}:${occurrenceDate}`;
}
