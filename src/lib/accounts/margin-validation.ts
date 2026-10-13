/**
 * Margin-loan field rules (spec 2026-10-13 margin loans). Pure, so the Zod
 * create schema and the account write core share one rule set — the PUT path
 * bypasses Zod and validates the RESULTING row here. Returns a user-facing
 * message, or null when the fields are valid. `< value` is deliberately NOT a
 * DB constraint: imports and holdings sync may lower value below the loan, and
 * the engine treats that as an underwater account (spec R7).
 */
export const MAX_MARGIN_INTEREST_RATE = 0.25;

export interface MarginFieldsInput {
  category: string;
  value: number;
  marginBalance: number;
  marginInterestRate: number;
  marginCallPct: number;
}

export function validateMarginFields(f: MarginFieldsInput): string | null {
  if (!Number.isFinite(f.marginBalance) || f.marginBalance < 0) {
    return "Margin loan balance can't be negative.";
  }
  if (f.marginBalance > 0 && f.category !== "taxable") {
    return "Only taxable brokerage accounts can carry a margin loan. Remove the margin loan before changing the account type.";
  }
  if (f.marginBalance > 0 && f.marginBalance >= f.value) {
    return "The margin loan must be less than the account's value.";
  }
  if (
    !Number.isFinite(f.marginInterestRate) ||
    f.marginInterestRate < 0 ||
    f.marginInterestRate > MAX_MARGIN_INTEREST_RATE
  ) {
    return "Margin interest rate must be between 0% and 25%.";
  }
  if (!Number.isFinite(f.marginCallPct) || f.marginCallPct <= 0 || f.marginCallPct >= 1) {
    return "Margin call level must be between 0% and 100%.";
  }
  return null;
}

/** Decimal-string-or-number → number, with null/"" → fallback. */
export function marginNum(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  return Number(v);
}
