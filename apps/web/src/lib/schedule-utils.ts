export interface ScheduleEntry {
  year: number;
  amount: number;
}

/** Fill every year in [startYear, endYear] with the same amount. */
export function fillFlat(
  startYear: number,
  endYear: number,
  amount: number
): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (let y = startYear; y <= endYear; y++) {
    entries.push({ year: y, amount });
  }
  return entries;
}

/** Fill with compound growth: amount × (1 + rate)^(year - startYear). */
export function fillGrowth(
  startYear: number,
  endYear: number,
  startAmount: number,
  rate: number
): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const amount = startAmount * Math.pow(1 + rate, y - startYear);
    entries.push({ year: y, amount: Math.round(amount * 100) / 100 });
  }
  return entries;
}

/** Fill [stepFrom, stepTo] with amount; all other years in [startYear, endYear] get $0. */
export function fillStep(
  startYear: number,
  endYear: number,
  stepFrom: number,
  stepTo: number,
  amount: number
): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (let y = startYear; y <= endYear; y++) {
    entries.push({ year: y, amount: y >= stepFrom && y <= stepTo ? amount : 0 });
  }
  return entries;
}
