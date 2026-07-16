/** "YYYY-MM-DD" → local-midnight Date. Avoids UTC shift from `new Date(iso)`. */
export function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Local Date → "YYYY-MM-DD". Inverse of `parseDateOnly`. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Feb-29 DOBs celebrate on Feb 28 in non-leap years. */
function birthdayInYear(dob: Date, year: number): Date {
  const candidate = new Date(year, dob.getMonth(), dob.getDate());
  if (dob.getMonth() === 1 && dob.getDate() === 29 && candidate.getMonth() !== 1) {
    return new Date(year, 1, 28);
  }
  return candidate;
}

export function nextBirthdayWithin(
  dobIso: string,
  today: Date,
  windowDays: number,
): { date: Date; turning: number } | null {
  const dob = parseDateOnly(dobIso);
  const t0 = startOfDay(today);
  const end = addDays(t0, windowDays);
  for (const year of [t0.getFullYear(), t0.getFullYear() + 1]) {
    const bday = birthdayInYear(dob, year);
    if (bday >= t0 && bday <= end) {
      return { date: bday, turning: year - dob.getFullYear() };
    }
  }
  return null;
}

export interface MilestoneHit {
  key: string;
  date: Date;
  label: string;
  why: string;
}

interface MilestoneDef {
  key: string;
  years: number;
  months: number; // extra calendar months past the birthday (59½ = 6)
  label: string;
  why: string;
}

export const MILESTONES: readonly MilestoneDef[] = [
  { key: "50", years: 50, months: 0, label: "turns 50", why: "Catch-up contributions eligible" },
  { key: "59.5", years: 59, months: 6, label: "turns 59½", why: "Penalty-free retirement withdrawals" },
  { key: "62", years: 62, months: 0, label: "turns 62", why: "Social Security eligibility" },
  { key: "65", years: 65, months: 0, label: "turns 65", why: "Medicare enrollment" },
  { key: "73", years: 73, months: 0, label: "turns 73", why: "Required minimum distributions begin" },
];

export function milestonesWithin(
  dobIso: string,
  today: Date,
  windowDays: number,
): MilestoneHit[] {
  const dob = parseDateOnly(dobIso);
  const t0 = startOfDay(today);
  const end = addDays(t0, windowDays);
  const hits: MilestoneHit[] = [];
  for (const m of MILESTONES) {
    // Anchor on the age-anniversary (Feb-29 DOBs land on Feb 28 in non-leap
    // years), then add calendar months; JS Date normalizes month overflow.
    const anniversary = birthdayInYear(dob, dob.getFullYear() + m.years);
    const date = new Date(
      anniversary.getFullYear(),
      anniversary.getMonth() + m.months,
      anniversary.getDate(),
    );
    if (date >= t0 && date <= end) {
      hits.push({ key: m.key, date, label: m.label, why: m.why });
    }
  }
  return hits;
}
