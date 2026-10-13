/**
 * Margin-loan field rules (spec 2026-10-13 margin loans). Pure, so the Zod
 * create schema and the account write core share one rule set — the PUT path
 * bypasses Zod and validates the RESULTING row here. Returns a user-facing
 * message, or null when the fields are valid. `< value` is deliberately NOT a
 * DB constraint: imports and holdings sync may lower value below the loan, and
 * the engine treats that as an underwater account (spec R7).
 */
import { DEFAULT_MARGIN_CALL_PCT } from "@/engine/margin";

export const MAX_MARGIN_INTEREST_RATE = 0.25;

/** R8 — the one rule the DB also enforces (`accounts_margin_taxable_only`).
 *  Exported for writers that check only this rule (the portal). */
export const MARGIN_TAXABLE_ONLY_MESSAGE =
  "Only taxable brokerage accounts can carry a margin loan. Remove the margin loan before changing the account type.";

/** Raw values as the create schema and the write core hold them (decimal
 *  strings or numbers); null/undefined/"" take the column default. */
export interface MarginFieldsInput {
  category: string;
  value: unknown;
  marginBalance: unknown;
  marginInterestRate: unknown;
  marginCallPct: unknown;
}

export function validateMarginFields(raw: MarginFieldsInput): string | null {
  const f = {
    category: raw.category,
    value: marginNum(raw.value, 0),
    marginBalance: marginNum(raw.marginBalance, 0),
    marginInterestRate: marginNum(raw.marginInterestRate, 0),
    marginCallPct: marginNum(raw.marginCallPct, DEFAULT_MARGIN_CALL_PCT),
  };
  if (!Number.isFinite(f.marginBalance) || f.marginBalance < 0) {
    return "Margin loan balance can't be negative.";
  }
  if (f.marginBalance > 0 && f.category !== "taxable") {
    return MARGIN_TAXABLE_ONLY_MESSAGE;
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

/** Decimal-string-or-number → number, with null/undefined/"" → fallback. */
function marginNum(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  return Number(v);
}
