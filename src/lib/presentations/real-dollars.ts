// Today's-dollars conversion for the presentation layer.
//
// Nominal figures over a 30–40 year horizon are mostly inflation. Every Your
// Early Years page deflates before it prints, so a client reads a number they
// can price against their current life.

export interface DeflationBasis {
  /** PlanSettings.inflationRate — a fraction, e.g. 0.03. */
  inflationRate: number;
  /** PlanSettings.planStartYear — the year whose purchasing power we quote in. */
  planStartYear: number;
}

/** Nominal dollars in `year` → dollars with `basis.planStartYear` purchasing power. */
export function toTodaysDollars(nominal: number, year: number, basis: DeflationBasis): number {
  const periods = year - basis.planStartYear;
  if (periods <= 0) return nominal;
  return nominal / Math.pow(1 + basis.inflationRate, periods);
}
