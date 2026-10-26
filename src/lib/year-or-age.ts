// One box, two ways to name a year.
//
// Advisors think in both — "the year Dan turns 65" as often as "2041" — so a
// year field takes either: four digits are a calendar year, two or three are
// the CLIENT's age (the primary person's — a couple's age is ambiguous, so it
// means the first person listed). The readout beside the box always names every
// person's age in the resolved year, which is what makes the age reading
// visible rather than a guess the advisor has to trust.

export interface AgePerson {
  name: string;
  birthYear: number;
}

/** The span a typed year may fall in unless a field narrows it. */
export const YEAR_MIN = 2000;
export const YEAR_MAX = 2100;

export type YearEntry = (
  | { kind: "year"; year: number }
  | { kind: "age"; age: number; year: number }
) & { inRange: boolean };

/**
 * Read what was typed. One digit is still mid-typing, not an age; an age needs
 * the client's birth year to mean anything, so without one it reads as nothing.
 * `inRange` says whether the year it names falls in [min, max].
 */
export function readYearOrAge(
  text: string,
  clientBirthYear: number | undefined,
  { min = YEAR_MIN, max = YEAR_MAX }: { min?: number; max?: number } = {},
): YearEntry | null {
  const t = text.trim();
  if (!/^\d{2,4}$/.test(t)) return null;
  const n = Number(t);
  const inRange = (year: number) => year >= min && year <= max;
  if (t.length === 4) return { kind: "year", year: n, inRange: inRange(n) };
  if (clientBirthYear == null) return null;
  const year = clientBirthYear + n;
  return { kind: "age", age: n, year, inRange: inRange(year) };
}

/** Each person's age in `year`, skipping anyone not yet born. */
export function agesInYear(year: number, people: AgePerson[]): { name: string; age: number }[] {
  return people
    .filter((p) => year >= p.birthYear)
    .map((p) => ({ name: p.name, age: year - p.birthYear }));
}

/** The household's people, client first — the order `readYearOrAge` relies on.
 *  A person without a birth year is left out (`date_of_birth` is nullable). */
export function householdAgePeople(
  birthYears: { clientBirthYear?: number; spouseBirthYear?: number },
  names: { client: string; spouse: string },
): AgePerson[] {
  const people: AgePerson[] = [];
  if (birthYears.clientBirthYear != null) {
    people.push({ name: names.client, birthYear: birthYears.clientBirthYear });
  }
  if (birthYears.spouseBirthYear != null) {
    people.push({ name: names.spouse, birthYear: birthYears.spouseBirthYear });
  }
  return people;
}
