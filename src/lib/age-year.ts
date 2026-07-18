/**
 * Age ↔ calendar-year conversions for household planning fields (retirement
 * age, life expectancy). The calendar year a person "reaches" an age is simply
 * `birthYear + age` — the year they turn that age.
 *
 * Birth year is sliced from the ISO date string rather than parsed via
 * `new Date(...)`, which reads back one year early for a Jan-1 DOB in a
 * negative-UTC timezone. Mirrors the engine's death-event and insurance
 * schedule helpers, which slice the year for the same reason.
 */

/** Birth year from an ISO date string, or null when missing/unparseable. */
export function birthYearFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const y = parseInt(String(dob).slice(0, 4), 10);
  return Number.isFinite(y) && y > 0 ? y : null;
}

/** Calendar year the person turns `age`, or null when birth year is unknown. */
export function yearForAge(
  birthYear: number | null,
  age: number,
): number | null {
  if (birthYear == null) return null;
  return birthYear + age;
}

/** Age the person is in `year`, or null when birth year is unknown. */
export function ageForYear(
  birthYear: number | null,
  year: number,
): number | null {
  if (birthYear == null) return null;
  return year - birthYear;
}

/**
 * Age as of `today`, with month/day precision so someone who has not yet had
 * this year's birthday reads a year younger. Month and day are sliced from the
 * ISO string for the same timezone reason as `birthYearFromDob`.
 */
export function ageOnDate(
  dob: string | null | undefined,
  today: Date,
): number | null {
  const birthYear = birthYearFromDob(dob);
  if (birthYear == null) return null;
  const month = parseInt(String(dob).slice(5, 7), 10);
  const day = parseInt(String(dob).slice(8, 10), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;

  let age = today.getFullYear() - birthYear;
  const monthDelta = today.getMonth() + 1 - month;
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < day)) age -= 1;
  return age;
}
