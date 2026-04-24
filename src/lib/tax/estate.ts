// IRC §2001(c) Unified Rate Schedule — constant, not DB-sourced.
// The 18%→40% graduated rates have been unchanged since 1977 and are set
// by statute, not indexed. The applicable exclusion amount (BEA) IS
// indexed — see beaForYear below.
export const UNIFIED_RATE_SCHEDULE: ReadonlyArray<{ over: number; base: number; rate: number }> = [
  { over:         0, base:       0, rate: 0.18 },
  { over:    10_000, base:   1_800, rate: 0.20 },
  { over:    20_000, base:   3_800, rate: 0.22 },
  { over:    40_000, base:   8_200, rate: 0.24 },
  { over:    60_000, base:  13_000, rate: 0.26 },
  { over:    80_000, base:  18_200, rate: 0.28 },
  { over:   100_000, base:  23_800, rate: 0.30 },
  { over:   150_000, base:  38_800, rate: 0.32 },
  { over:   250_000, base:  70_800, rate: 0.34 },
  { over:   500_000, base: 155_800, rate: 0.37 },
  { over:   750_000, base: 248_300, rate: 0.39 },
  { over: 1_000_000, base: 345_800, rate: 0.40 },
];

export function applyUnifiedRateSchedule(amount: number): number {
  if (amount <= 0) return 0;
  // Walk rows from highest to lowest; the first row whose `over` is strictly
  // below `amount` is the applicable bracket. At an exact boundary
  // (amount === row.over) we return row.base with no marginal increment —
  // the test expectations depend on this semantics.
  for (let i = UNIFIED_RATE_SCHEDULE.length - 1; i >= 0; i--) {
    const row = UNIFIED_RATE_SCHEDULE[i];
    if (amount >= row.over) {
      return row.base + row.rate * (amount - row.over);
    }
  }
  return 0;
}

/**
 * Basic Exclusion Amount (BEA), IRC §2010(c)(3). OBBBA (2025) made the
 * TCJA-expanded amount permanent and set 2026's BEA to $15M, indexed for
 * inflation going forward. No sunset branch.
 */
export const BEA_2026 = 15_000_000;

export function beaForYear(year: number, taxInflationRate: number): number {
  if (year <= 2026) return BEA_2026;
  return BEA_2026 * Math.pow(1 + taxInflationRate, year - 2026);
}
