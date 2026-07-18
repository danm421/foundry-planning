// src/lib/retirement/retirement-facts.ts
//
// Plan-authoritative retirement facts for one person, for surfaces that must
// state retirement timing rather than just a countdown — the 360 AI battery and
// the overview "years to retirement" KPI. Motivated by the defect where the AI
// had only "years to retirement" and no age/year to check advisor notes
// against, so it restated a stale discovery note as the plan's timeline.
//
// Calendar-year arithmetic goes through `@/lib/age-year`, which slices the year
// out of the ISO string instead of parsing it — `new Date("1979-01-01")` reads
// back as 1978 in a negative-UTC timezone.

import { ageOnDate, birthYearFromDob, yearForAge } from "@/lib/age-year";

export interface PersonRetirementFacts {
  /** Display name — preferred name when set, else first name. */
  label: string;
  currentAge: number | null;
  retirementAge: number;
  /** Calendar year of retirement; null when the DOB is unknown. */
  retirementYear: number | null;
}

export interface PersonRetirementInput {
  firstName?: string | null;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  retirementAge?: number | null;
}

/** Null when the person has no retirement age on file (nothing to assert). */
export function personRetirementFacts(
  person: PersonRetirementInput | null | undefined,
  today: Date,
): PersonRetirementFacts | null {
  if (!person || person.retirementAge == null) return null;
  return {
    label: person.preferredName?.trim() || person.firstName?.trim() || "Client",
    currentAge: ageOnDate(person.dateOfBirth, today),
    retirementAge: person.retirementAge,
    retirementYear: yearForAge(birthYearFromDob(person.dateOfBirth), person.retirementAge),
  };
}

/**
 * Whole years until the first person in the household retires — the "years to
 * retirement" KPI. Floors at 0 once that year has passed, and ignores people
 * whose DOB is unknown (no derivable year). Null when nobody has both.
 */
export function yearsUntilFirstRetirement(
  people: PersonRetirementFacts[],
  today: Date,
): number | null {
  const years = people
    .map((p) => p.retirementYear)
    .filter((y): y is number => y != null);
  if (years.length === 0) return null;
  return Math.max(Math.min(...years) - today.getFullYear(), 0);
}
