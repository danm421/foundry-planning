/**
 * Client-entered loan terms for a portal debt: the interest rate and monthly
 * payment a client reads off a statement, plus the payoff term derived from
 * them.
 *
 * Why the client has to type these: Plaid's Liabilities product returns rate /
 * payment detail for credit cards, mortgages and student loans ONLY — never
 * for auto or personal loans (see LiabilitiesObject in the plaid SDK). Without
 * a term the engine cannot amortize the debt at all and holds the balance flat
 * forever, so the client's numbers are the only way an auto loan is ever paid
 * down in the projection. See engine/liability-kind.ts (`isHeldFlatLiability`).
 *
 * The term is always DERIVED here, never read off the request body: a payment
 * and a term that disagreed would amortize toward a balance the client never
 * typed. Deriving makes the pair consistent by construction and leaves the
 * client two numbers to enter instead of three.
 *
 * One function serves the POST route, the PUT route and the form's live
 * preview, so the rule a client is shown while typing is the rule the API
 * enforces. Pure — no DB or framework deps — so the "use client" debt form can
 * import it, the same reason `plaid-locked-fields.ts` stays dependency-free
 * while the rest of `src/lib/portal/` is server-only.
 */
import { calcInterestOnlyPayment, calcTerm, scheduleEndYear } from "@/lib/loan-math";
import { isRevolvingLiability, type LiabilityType } from "@/engine/liability-kind";
import { fmtUsd } from "@/lib/portal/format";

/** 50 years. Past this the entered numbers are wrong, not a real loan. */
export const MAX_LOAN_TERM_MONTHS = 600;

/** Rates arrive as annual FRACTIONS ("0.0649"), matching liabilities.interest_rate. */
export const MAX_INTEREST_RATE = 1;

/**
 * The month a portal-entered schedule starts, and it is load-bearing rather
 * than laziness. `computeAmortizationSchedule()` bounds the schedule with
 * `scheduleEndYear()` but simulates only `12 - startMonth + 1` months in the
 * first calendar year, so a mid-year start runs out of window before the term
 * is up and its "absorb the rounding dust" step swallows a real four-figure
 * balance as a phantom balloon payment — measured at $7,654 against a normal
 * $5,040 year on a 239-month loan. January sidesteps that, and it stays the
 * honest value even once the loan-math defect is fixed: the portal collects no
 * origination month and reports a payoff YEAR.
 */
export const LOAN_SCHEDULE_START_MONTH = 1;

/**
 * Revolving debt is held at its balance by the engine (card spending is
 * already modelled as expenses), so a payoff schedule would be stored and then
 * ignored — worse than absent, because it looks modelled. Asks the engine's
 * own predicate rather than restating it, so a second revolving type would be
 * excluded here too.
 */
export function supportsLoanDetails(liabilityType: string | null | undefined): boolean {
  return !isRevolvingLiability({
    liabilityType: (liabilityType ?? null) as LiabilityType | null,
  });
}

/** The `liabilities` columns these terms map to. */
export interface LoanTermColumns {
  /** Annual fraction, decimal(5,4). "0" when the client cleared the terms. */
  interestRate: string;
  monthlyPayment: string | null;
  termMonths: number | null;
  /**
   * A DISPLAY unit for the advisor's liability form, not engine input (the
   * engine reads termMonths alone). A derived term is rarely a whole number of
   * years and the column defaults to "annual", which would render 239 months
   * as "19.9166" years and, on the advisor's next save, parseInt() it back to
   * 228. "monthly" makes a derived term round-trip.
   */
  termUnit: "monthly" | "annual";
}

export type LoanDetailsResult =
  | { ok: true; columns: LoanTermColumns }
  | { ok: false; error: string };

/** Held-flat defaults — no schedule, balance stays put on the projection. */
export const CLEARED_LOAN_COLUMNS: LoanTermColumns = {
  interestRate: "0",
  monthlyPayment: null,
  termMonths: null,
  termUnit: "annual",
};

function toNumberOrNull(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validates a client-supplied rate + payment against the debt's balance and
 * type, and derives the payoff term. A missing or non-positive payment clears
 * the terms (back to held-flat) rather than erroring — that is how a client
 * removes them.
 *
 * `interestRate` is an annual fraction, not a percent: 6.49% arrives as
 * 0.0649. The <= 1 ceiling is deliberately also the guard that catches a
 * caller sending "6.49" by mistake.
 */
export function resolveLoanDetails(
  balance: number,
  liabilityType: string | null | undefined,
  input: { interestRate?: unknown; monthlyPayment?: unknown },
): LoanDetailsResult {
  const monthlyPayment = toNumberOrNull(input.monthlyPayment);
  const rawRate = toNumberOrNull(input.interestRate);

  // No payment = no schedule. Clearing is a legitimate edit, not an error.
  if (monthlyPayment == null || monthlyPayment <= 0) {
    return { ok: true, columns: CLEARED_LOAN_COLUMNS };
  }
  if (!supportsLoanDetails(liabilityType)) {
    return {
      ok: false,
      error: "A credit card is held at its balance and doesn't take payment terms.",
    };
  }
  if (input.interestRate != null && input.interestRate !== "" && rawRate == null) {
    return { ok: false, error: "Enter the interest rate as a number." };
  }
  const interestRate = rawRate ?? 0;
  if (interestRate < 0 || interestRate > MAX_INTEREST_RATE) {
    return { ok: false, error: "Enter an interest rate between 0% and 100%." };
  }
  if (monthlyPayment > 1e9) {
    return { ok: false, error: "That monthly payment is too large." };
  }
  if (!Number.isFinite(balance) || balance <= 0) {
    return { ok: false, error: "Enter this debt's balance before its payment terms." };
  }

  const termMonths = calcTerm(balance, interestRate, monthlyPayment);
  if (!Number.isFinite(termMonths)) {
    const interestOnly = calcInterestOnlyPayment(balance, interestRate);
    return {
      ok: false,
      error:
        `A payment of ${fmtUsd(monthlyPayment)} doesn't cover this loan's monthly ` +
        `interest of about ${fmtUsd(interestOnly)}, so the balance would never be ` +
        `paid off. Check the rate and payment.`,
    };
  }
  if (termMonths > MAX_LOAN_TERM_MONTHS) {
    return {
      ok: false,
      error:
        `That rate and payment would take about ${Math.round(termMonths / 12)} years ` +
        `to pay off. Check the numbers.`,
    };
  }

  return {
    ok: true,
    columns: {
      interestRate: interestRate.toFixed(4),
      // A payment at or above the balance clears it next month, and calcTerm
      // can round that to 0 — an empty schedule the engine reads as held-flat.
      termMonths: Math.max(1, termMonths),
      monthlyPayment: monthlyPayment.toFixed(2),
      termUnit: "monthly",
    },
  };
}

/**
 * The calendar year the debt is paid off IN THE PLAN.
 *
 * Deliberately a year, not a month: the engine emits one schedule row per
 * calendar year, so a month is precision the projection does not have, and
 * quoting one would drift from the year the client's plan actually shows.
 * Reads the engine's own window bound rather than keeping a copy of it.
 *
 * `startMonth` must be the debt's real origination month, not
 * LOAN_SCHEDULE_START_MONTH. Client-entered terms are pinned to January by the
 * routes, but the portal lists every debt on the household — including the
 * mortgages an advisor entered with a true mid-year origination — and those
 * only make `12 - startMonth + 1` payments in their first calendar year. It
 * defaults to January so a caller without the month gets the old answer rather
 * than a wrong one.
 */
export function payoffYear(
  startYear: number,
  termMonths: number | null,
  startMonth = 1,
): number | null {
  if (termMonths == null || termMonths <= 0) return null;
  return scheduleEndYear(startYear, termMonths, startMonth);
}
