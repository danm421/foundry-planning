import type { EarlyYearsDebtOrInvestPageOptions } from "./types";

export function summarizeEarlyYearsDebtOrInvestOptions(
  o: EarlyYearsDebtOrInvestPageOptions,
): string {
  const loan = o.liabilityId == null ? "largest loan" : "chosen loan";
  const tid =
    o.tidbits.length === 0
      ? "no tidbits"
      : `${o.tidbits.length} tidbit${o.tidbits.length > 1 ? "s" : ""}`;
  return `$${Math.round(o.monthlyAmount)}/mo · ${loan} · at ${o.milestoneAge} · ${tid}`;
}
