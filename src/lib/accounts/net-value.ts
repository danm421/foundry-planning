/** Account value net of its margin loan (spec 2026-10-13 R3). For screens that
 *  sum DB rows instead of running the projection. AUM/book value stays gross —
 *  do NOT use this in src/lib/home/kpis.ts. */
export function netAccountValue(row: {
  value?: string | number | null;
  marginBalance?: string | number | null;
}): number {
  return Number(row.value ?? 0) - Number(row.marginBalance ?? 0);
}
