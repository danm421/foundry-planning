/** Resolve the PV discount rate for actuarial valuations. Mirrors the
 *  taxInflationRate ?? inflationRate ?? 0 fallback used elsewhere. */
export function resolvePvDiscountRate(
  planSettings: { pvDiscountRate?: number | null; inflationRate?: number | null },
): number {
  return planSettings.pvDiscountRate ?? planSettings.inflationRate ?? 0;
}
