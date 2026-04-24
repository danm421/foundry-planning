export type TaxYearRow = {
  year: number;
  giftAnnualExclusion: number;
};

const FALLBACK = 18_000;

export function resolveAnnualExclusion(
  year: number,
  rows: TaxYearRow[],
  inflationRate: number,
): number {
  const hit = rows.find((r) => r.year === year);
  if (hit) return hit.giftAnnualExclusion;

  if (rows.length === 0) return FALLBACK;

  const latest = rows.reduce((acc, r) => (r.year > acc.year ? r : acc), rows[0]);
  const years = year - latest.year;
  const projected = latest.giftAnnualExclusion * Math.pow(1 + inflationRate, years);
  return Math.round(projected / 1000) * 1000;
}
