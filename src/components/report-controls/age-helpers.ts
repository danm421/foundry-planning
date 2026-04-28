export interface OwnerDobs {
  clientDob: string;
  spouseDob?: string | null;
}

export function ageAtYear(dob: string | null | undefined, year: number): number | null {
  if (!dob) return null;
  return year - new Date(dob).getUTCFullYear();
}

/** "65" or "65/63" depending on whether spouse is present. Empty string if no DOBs. */
export function formatAges(year: number, dobs: OwnerDobs): string {
  const c = ageAtYear(dobs.clientDob, year);
  const s = dobs.spouseDob ? ageAtYear(dobs.spouseDob, year) : null;
  if (c != null && s != null) return `${c}/${s}`;
  if (c != null) return String(c);
  return "";
}
