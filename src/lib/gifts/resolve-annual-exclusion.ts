export type TaxYearRow = {
  year: number;
  giftAnnualExclusion: number;
};

// §2503(b) exclusion for 2025/2026 is $19,000. Only reached when no seeded rows
// exist at all (e.g. an empty tax table); seeded years use their real values and
// out-years project forward from the latest seeded row.
const FALLBACK = 19_000;

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

/** Loose row shape accepted by {@link buildAnnualExclusionMap}. pg-numeric
 *  columns can arrive as strings (raw DB / API JSON) or numbers (already parsed
 *  by `dbRowToTaxYearParameters`), so both are coerced here in one place. */
export type AnnualExclusionRow = {
  year: number;
  giftAnnualExclusion?: number | string | null;
};

/**
 * Build a dense year→§2503(b) annual-exclusion map across a plan horizon.
 *
 * Seeded years keep their exact values; years past the latest seeded row are
 * forward-projected (rounded to the nearest $1k) via {@link resolveAnnualExclusion},
 * mirroring how the income-tax resolver inflates future years. Without this,
 * consumers that read `map[year] ?? 0` silently apply a $0 exclusion to any gift
 * dated past the last seeded tax year — taxing the whole gift (audit F2).
 */
export function buildAnnualExclusionMap(
  rows: AnnualExclusionRow[],
  planStartYear: number,
  planEndYear: number,
  inflationRate: number,
): Record<number, number> {
  const seeded: TaxYearRow[] = [];
  for (const r of rows) {
    if (r.giftAnnualExclusion == null) continue;
    const value =
      typeof r.giftAnnualExclusion === "string"
        ? parseFloat(r.giftAnnualExclusion)
        : r.giftAnnualExclusion;
    seeded.push({ year: r.year, giftAnnualExclusion: value });
  }

  const map: Record<number, number> = {};
  for (const r of seeded) map[r.year] = r.giftAnnualExclusion;
  for (let year = planStartYear; year <= planEndYear; year++) {
    if (map[year] == null) {
      map[year] = resolveAnnualExclusion(year, seeded, inflationRate);
    }
  }
  return map;
}
