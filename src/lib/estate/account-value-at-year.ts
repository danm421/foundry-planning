import type { ProjectionYear } from "@/engine/types";

/**
 * Resolves an account's projected balance at a projection year, or undefined
 * when the projection holds no row for that year / no ledger for that account
 * (a gift dated before `planStartYear`, or a pre-activation account).
 *
 * Callers that must produce a number treat undefined as 0 — that is what the
 * engine does. Callers showing the figure to an advisor should keep the
 * distinction, so they can say whether the number is projected or a fallback.
 */
export type AccountValueAtYear = (
  accountId: string,
  year: number,
) => number | undefined;

/**
 * Build the account-balance resolver the engine values an in-kind gift with.
 *
 * `runProjectionWithEvents` reads `accountLedgers[id].endingValue` for the gift
 * year (see `projection.ts`), so every surface that previews, reports on, or
 * sizes an asset gift has to read the same field or it will quote a different
 * number than the exemption the gift actually consumes. This factory exists so
 * that read is written once.
 */
export function buildAccountValueAtYear(years: ProjectionYear[]): AccountValueAtYear {
  const yearByYear = new Map(years.map((y) => [y.year, y]));
  return (accountId, year) =>
    yearByYear.get(year)?.accountLedgers?.[accountId]?.endingValue;
}
