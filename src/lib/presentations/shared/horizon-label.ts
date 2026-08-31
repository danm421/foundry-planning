// src/lib/presentations/shared/horizon-label.ts

/**
 * How a comparison page names the year(s) behind an "at retirement" figure.
 *
 * Two plans that retire in different years cannot share one label: printing the
 * scenario's year over both columns told the reader the base plan's portfolio
 * was measured five years before it actually retires. When the years match
 * there is nothing to disambiguate, so the label stays a bare year.
 *
 * `baseName` varies by surface — the PDF's paired columns read "Current", the
 * web table reads "Base".
 */
export function horizonYearsLabel(
  baseYear: number,
  scenarioYear: number,
  baseName = "base",
  scenarioName = "proposed",
): string {
  if (baseYear === scenarioYear) return String(baseYear);
  return `${baseName} ${baseYear} · ${scenarioName} ${scenarioYear}`;
}
