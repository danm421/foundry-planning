import type { ExtractedLiability } from "@/lib/extraction/types";

/**
 * A liability's schedule anchors, derived from what a statement actually
 * prints.
 *
 * WHY START == AS-OF. `engine/liability-schedules.ts` back-solves the loan's
 * ORIGINAL balance from the gap between `startYear/startMonth` and
 * `balanceAsOfYear/Month`, then amortizes forward from origination. A mortgage
 * statement prints the maturity date and the current balance, and almost never
 * the origination date — so guessing an origination would invent an elapsed
 * period and, with it, a fabricated original balance.
 *
 * Setting start = as-of makes the elapsed gap zero, so `calcOriginalBalance`
 * returns today's balance unchanged and the schedule runs from today to the
 * printed maturity. The payoff year and every projected year are correct; the
 * only thing lost is loan history before today, which the document did not
 * state either.
 */
export interface LiabilityTerm {
  startYear: number;
  /** 1-12. */
  startMonth: number;
  /** Null when the statement printed no balance date — never today's. */
  balanceAsOfYear: number | null;
  /** 1-12, or null. */
  balanceAsOfMonth: number | null;
  termMonths: number;
}

/** The schema's own historical placeholder, kept for the no-maturity case. */
const FALLBACK_TERM_MONTHS = 360;

/** Parse an ISO YYYY-MM-DD into {year, month}; null for anything else. */
function parseIsoMonth(value: string | undefined): { year: number; month: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return { year, month };
}

function monthsBetween(
  from: { year: number; month: number },
  to: { year: number; month: number },
): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

export function deriveLiabilityTerm(
  row: Pick<ExtractedLiability, "balanceAsOfDate" | "maturityDate">,
  today: Date,
): { term: LiabilityTerm; warning?: string } {
  const asOf = parseIsoMonth(row.balanceAsOfDate);
  const maturity = parseIsoMonth(row.maturityDate);

  // The start anchor. An undated balance falls back to today for the SCHEDULE
  // anchor but leaves the as-of columns null: those columns are a record of
  // what the statement said, and it said nothing.
  const start = asOf ?? {
    year: today.getUTCFullYear(),
    month: today.getUTCMonth() + 1,
  };

  const base: LiabilityTerm = {
    startYear: start.year,
    startMonth: start.month,
    balanceAsOfYear: asOf ? asOf.year : null,
    balanceAsOfMonth: asOf ? asOf.month : null,
    termMonths: FALLBACK_TERM_MONTHS,
  };

  if (!maturity) {
    return {
      term: base,
      warning:
        "The statement printed no maturity date, so this loan was given a 30-year term. " +
        "Check the term before committing.",
    };
  }

  const months = monthsBetween(start, maturity);
  if (months <= 0) {
    return {
      term: base,
      warning:
        `This loan matures before the balance date it was read from ` +
        `(${row.maturityDate} vs ${row.balanceAsOfDate ?? "today"}), so a 30-year term was used ` +
        "instead. Check both dates before committing.",
    };
  }

  return { term: { ...base, termMonths: months } };
}
