interface SelectDetailYearsArgs {
  availableYears: number[];
  planStartYear: number;
  requiredYears: number[];
  maxRows: number;
}

/** Measured one-Letter-sheet row budgets for the five detail layouts. */
export const HUMAN_CAPITAL_DETAIL_MAX_ROWS = 10;
export const EARLY_YEARS_GROUPED_DETAIL_MAX_ROWS = 16;
export const ROTH_DETAIL_MAX_ROWS = 14;
export const DEBT_OR_INVEST_DETAIL_MAX_ROWS = 12;

/**
 * Five-year detail with boundary years kept even when a long plan needs
 * thinning. Returns only years the engine actually projected.
 */
export function selectEarlyYearsDetailYears({
  availableYears,
  planStartYear,
  requiredYears,
  maxRows,
}: SelectDetailYearsArgs): number[] {
  const available = new Set(availableYears);
  const required = [...new Set(requiredYears.filter((year) => available.has(year)))];
  const candidates = [...available].filter(
    (year) => (year - planStartYear) % 5 === 0 || required.includes(year),
  );
  const sorted = [...new Set(candidates)].sort((a, b) => a - b);
  if (sorted.length <= maxRows) return sorted;

  const requiredSet = new Set(required);
  const regular = sorted.filter((year) => !requiredSet.has(year));
  const slots = Math.max(0, maxRows - required.length);
  const picked = new Set(required);

  if (slots === 1 && regular.length > 0) {
    picked.add(regular[Math.floor((regular.length - 1) / 2)]);
  } else if (slots > 1) {
    for (let i = 0; i < slots; i += 1) {
      picked.add(regular[Math.round((i * (regular.length - 1)) / (slots - 1))]);
    }
  }

  return [...picked].sort((a, b) => a - b);
}
