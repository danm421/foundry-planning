import type { SecurityType } from "./classification/types";

/** Above this, the value is not a fund fee — it is a unit error or garbage. */
const MAX_PLAUSIBLE_RATIO = 0.25;

/**
 * Normalize a raw provider value to a decimal fraction.
 *
 * `divisor` carries the provider's unit for this field: 1 when the value is
 * already a fraction, 100 when it is a percent.
 *
 * Zero resolves to null. Some funds genuinely are free, but most zeros in the
 * payload are missing data, and the asymmetry decides it: printing a real 0%
 * as "not available" costs nothing, while printing missing data as 0% inflates
 * a claimed saving on a document a client keeps.
 */
function normalize(v: unknown, divisor: number): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const ratio = n / divisor;
  return ratio > MAX_PLAUSIBLE_RATIO ? null : ratio;
}

/**
 * Fund expense ratio from a raw EODHD fundamentals payload, as a decimal
 * fraction (0.0003 = 3 bps). Null means "we don't know", never "free".
 *
 * Verified against the dev branch on 2026-08-12:
 *   ETF          ETF_Data.NetExpenseRatio        decimal   VTI "0.00030" -> 0.03%
 *   Mutual fund  MutualFund_Data.Expense_Ratio   PERCENT   DBLTX "0.5000" -> 0.50%
 *
 * `ETF_Data.Ongoing_Charge` and `Max_Annual_Mgmt_Charge` are deliberately NOT
 * read. Both are zero-filled for AGG, BND, EFA, IWM, QQQ and VTI and null for
 * SPY and VOO — using either as a fallback reports most major ETFs as free.
 */
export function expenseRatioFromPayload(
  raw: unknown,
  securityType: SecurityType,
): number | null {
  // An individual security carries no fund fee. This is a real zero, and it
  // comes from the type, not from the payload.
  if (securityType === "stock" || securityType === "bond" || securityType === "cash") {
    return 0;
  }
  if (raw == null || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;

  if (securityType === "etf") {
    const etf = payload.ETF_Data as Record<string, unknown> | undefined;
    return normalize(etf?.NetExpenseRatio, 1);
  }
  if (securityType === "mutual_fund") {
    const mf = payload.MutualFund_Data as Record<string, unknown> | undefined;
    return normalize(mf?.Expense_Ratio, 100);
  }
  return null;
}
