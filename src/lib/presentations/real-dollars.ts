// Today's-dollars conversion for the presentation layer.
//
// Nominal figures over a 30–40 year horizon are mostly inflation. Your Early
// Years preserves the engine's future-year result beside its start-year
// purchasing power, with today's dollars as the primary reading unit.

export interface DeflationBasis {
  /** The effective tree's resolved inflation rate — a fraction, e.g. 0.03. */
  inflationRate: number;
  /** PlanSettings.planStartYear — the year whose purchasing power we quote in. */
  planStartYear: number;
}

/** One engine figure in the two units the Early Years sheets explain. */
export interface DollarPair {
  /** Purchasing power in the plan's start year. */
  today: number;
  /** The engine's unchanged result in the year it occurs. */
  nominal: number;
}

/** Nominal dollars in `year` → dollars with `basis.planStartYear` purchasing power. */
export function toTodaysDollars(nominal: number, year: number, basis: DeflationBasis): number {
  const periods = year - basis.planStartYear;
  if (periods <= 0) return nominal;
  return nominal / Math.pow(1 + basis.inflationRate, periods);
}

/** Preserve the engine result while adding its start-year purchasing power. */
export function dollarPair(
  nominal: number,
  year: number,
  basis: DeflationBasis,
): DollarPair {
  return { today: toTodaysDollars(nominal, year, basis), nominal };
}

/** Sum a stream without mixing its real and nominal units. */
export function sumDollarPairs(pairs: DollarPair[]): DollarPair {
  return pairs.reduce(
    (sum, pair) => ({
      today: sum.today + pair.today,
      nominal: sum.nominal + pair.nominal,
    }),
    { today: 0, nominal: 0 },
  );
}

/** Absolute difference between two outcomes, kept in both units. */
export function absoluteDollarDifference(a: DollarPair, b: DollarPair): DollarPair {
  return {
    today: Math.abs(a.today - b.today),
    nominal: Math.abs(a.nominal - b.nominal),
  };
}
