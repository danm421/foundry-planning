/**
 * Monthly payment from balance, annual rate, and term in months.
 * Standard amortization formula: P × r(1+r)^n / ((1+r)^n − 1)
 */
export function calcPayment(
  balance: number,
  annualRate: number,
  termMonths: number
): number {
  if (termMonths <= 0) return 0;
  if (annualRate === 0) return balance / termMonths;
  const r = annualRate / 12;
  const factor = Math.pow(1 + r, termMonths);
  return balance * r * factor / (factor - 1);
}

/**
 * Term in months from balance, annual rate, and monthly payment.
 * n = −ln(1 − balance × r / payment) / ln(1 + r)
 * Returns Infinity if payment ≤ monthly interest (never pays off).
 */
export function calcTerm(
  balance: number,
  annualRate: number,
  monthlyPayment: number
): number {
  if (monthlyPayment <= 0) return Infinity;
  if (annualRate === 0) return Math.ceil(balance / monthlyPayment);
  const r = annualRate / 12;
  const monthlyInterest = balance * r;
  if (monthlyPayment <= monthlyInterest) return Infinity;
  return Math.round(-Math.log(1 - balance * r / monthlyPayment) / Math.log(1 + r));
}

/**
 * Annual interest rate from balance, term in months, and monthly payment.
 * Uses Newton-Raphson iteration on the amortization formula.
 * Returns null if the solver does not converge within 100 iterations.
 */
export function calcRate(
  balance: number,
  termMonths: number,
  monthlyPayment: number
): number | null {
  if (balance <= 0 || termMonths <= 0 || monthlyPayment <= 0) return null;

  // Check if zero-interest matches
  if (Math.abs(monthlyPayment - balance / termMonths) < 0.01) return 0;

  let r = 0.005; // initial guess: 6% annual / 12
  const n = termMonths;

  for (let i = 0; i < 100; i++) {
    const rn = Math.pow(1 + r, n);
    const f = balance * r * rn / (rn - 1) - monthlyPayment;
    // derivative of amortization formula w.r.t. r
    const drndr = n * Math.pow(1 + r, n - 1);
    const num = rn + r * drndr;
    const den = rn - 1;
    const dfdr = balance * (num * den - r * rn * drndr) / (den * den);

    if (Math.abs(dfdr) < 1e-12) return null;
    const rNext = r - f / dfdr;
    if (rNext <= 0) r = r / 2; // guard against negative
    else r = rNext;

    if (Math.abs(f) < 0.01) return r * 12;
  }

  return null;
}

/**
 * Monthly payment on an interest-only loan: one month of accrued interest and
 * nothing more, so the balance never amortizes and the principal comes due as a
 * balloon at the end of term.
 */
export function calcInterestOnlyPayment(
  balance: number,
  annualRate: number
): number {
  if (balance <= 0 || annualRate <= 0) return 0;
  return balance * annualRate / 12;
}

/**
 * How close a payment must sit to accrued interest before it counts as
 * interest-only. A payment persisted at two decimal places never equals the
 * true accrual exactly, and the difference is a fraction of a cent — real
 * enough to compound over 360 months if it is treated as under-payment.
 */
export const INTEREST_ONLY_TOLERANCE = 0.01;

/**
 * True when `monthlyPayment` covers the accrued interest and nothing more.
 * Tolerant to a cent so a payment persisted at 2dp still reads as interest-only.
 * A loan with no balance or no rate is never interest-only — its accrued
 * interest is $0, which would otherwise match every $0 payment.
 */
export function isInterestOnlyPayment(
  balance: number,
  annualRate: number,
  monthlyPayment: number
): boolean {
  const interestOnly = calcInterestOnlyPayment(balance, annualRate);
  if (interestOnly <= 0) return false;
  return Math.abs(monthlyPayment - interestOnly) < INTEREST_ONLY_TOLERANCE;
}

/**
 * Back-calculate the original loan balance at origination given the current
 * balance, annual interest rate, monthly payment, and elapsed months.
 *
 * Formula: B = (B_k + P * ((1+r)^k - 1) / r) / (1+r)^k
 * where r = annualRate/12, k = elapsedMonths, B_k = currentBalance, P = monthlyPayment.
 */
export function calcOriginalBalance(
  currentBalance: number,
  annualRate: number,
  monthlyPayment: number,
  elapsedMonths: number
): number {
  if (elapsedMonths <= 0) return currentBalance;
  if (annualRate === 0) return currentBalance + monthlyPayment * elapsedMonths;
  const r = annualRate / 12;
  const factor = Math.pow(1 + r, elapsedMonths);
  return (currentBalance + monthlyPayment * (factor - 1) / r) / factor;
}

export interface AmortizationScheduleRow {
  year: number;
  beginningBalance: number;
  payment: number;
  interest: number;
  /** Principal repaid this year. NEGATIVE when the payment did not cover
   *  accrued interest and the shortfall capitalized into the balance. */
  principal: number;
  extraPayment: number;
  endingBalance: number;
  /** Calendar month (1-12) of this year's FIRST payment. An October-originated
   *  loan reports 10 in its origination year and 1 in every year after. */
  firstPaymentMonth: number;
  /** Payments this calendar year actually made. Twelve in a full year, fewer
   *  in the origination year and in the payoff year. Consumed by the solver's
   *  month-by-month view to place debt in the months it is really paid. */
  paymentCount: number;
}

export interface ScheduleExtraPayment {
  year: number;
  type: "per_payment" | "lump_sum";
  amount: number;
}

/**
 * Full amortization schedule from loan parameters + optional extra payments.
 * Returns one row per year from startYear until payoff or contractual end.
 *
 * `startMonth` (1-12) is the calendar month the loan originates in. A loan that
 * starts mid-year only makes `12 − startMonth + 1` payments in its first
 * calendar year, so the startYear row simulates that many months instead of a
 * full 12. Defaults to 1 (January) — a January origination is unchanged.
 */
/**
 * Last calendar year `computeAmortizationSchedule` will emit a row for — the
 * year the loan's final payment falls in.
 *
 * Exported so callers that need to name the payoff year — the portal's "Paid
 * off in ____" among them — read the schedule's own bound rather than keeping
 * a second copy of this expression in sync by hand.
 *
 * `startMonth` (1-12) matters because the schedule simulates only
 * `12 - startMonth + 1` months in the first calendar year: an October
 * origination spends 3 of its payments in the start year, so a 60-month term
 * runs 9 months past the fifth December. Bounding on the term alone cut the
 * window short by `startMonth - 1` months and left the schedule's "absorb the
 * rounding dust" step to dump the whole unpaid remainder into one phantom
 * balloon payment. Defaults to 1, so a January loan is unchanged.
 */
/**
 * Payments a schedule collects in its origination calendar year. An October
 * loan makes Oct–Dec = 3 of them; a January loan makes all 12.
 *
 * Exported for the same reason as `scheduleEndYear`: it is the other half of
 * how a term is divided into calendar years, and a caller that reimplements it
 * silently drifts out of step with the schedule it is describing.
 */
export function monthsInOriginationYear(startMonth = 1): number {
  return 13 - startMonth;
}

export function scheduleEndYear(
  startYear: number,
  termMonths: number,
  startMonth = 1
): number {
  return startYear + Math.ceil((termMonths + startMonth - 1) / 12) - 1;
}

export function computeAmortizationSchedule(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
  startYear: number,
  termMonths: number,
  extraPayments: ScheduleExtraPayment[] = [],
  startMonth = 1
): AmortizationScheduleRow[] {
  const endYear = scheduleEndYear(startYear, termMonths, startMonth);
  const rows: AmortizationScheduleRow[] = [];
  const r = annualRate / 12;
  let bal = balance;

  for (let year = startYear; year <= endYear; year++) {
    if (bal <= 0) break;

    const beginningBalance = bal;

    // Collect extra payments for this year
    const perPaymentExtra = extraPayments
      .filter((ep) => ep.year === year && ep.type === "per_payment")
      .reduce((sum, ep) => sum + ep.amount, 0);
    const lumpSum = extraPayments
      .filter((ep) => ep.year === year && ep.type === "lump_sum")
      .reduce((sum, ep) => sum + ep.amount, 0);

    // A mid-year-originated loan makes fewer than 12 payments in its first
    // calendar year (e.g. a July start makes Jul–Dec = 6). Every later calendar
    // year still simulates a full 12 months.
    const monthsThisYear = year === startYear ? monthsInOriginationYear(startMonth) : 12;

    // Simulate this calendar year's months of amortization
    let yearInterest = 0;
    let yearScheduledPayment = 0;
    let yearPrincipal = 0;
    let yearExtraPayment = 0;
    let lumpApplied = false;
    let monthsPaidThisYear = 0;

    for (let m = 0; m < monthsThisYear; m++) {
      if (bal <= 0) break;

      const monthlyInterest = bal * r;
      const scheduled = Math.min(monthlyPayment, bal + monthlyInterest);
      // A payment that covers accrued interest to the cent is interest-only BY
      // INTENT, and its principal is exactly zero — see INTEREST_ONLY_TOLERANCE.
      // Below that tolerance the payment is genuinely short, and the shortfall
      // CAPITALIZES: principal goes negative and the balance grows. That is what
      // an income-driven student loan does, and what calcOriginalBalance above
      // already assumes when it back-solves an origination balance. Flooring
      // this at zero made the two disagree and discarded the balance the advisor
      // entered — measured at $15,205 on a five-year-old loan.
      const principalFromPayment =
        Math.abs(scheduled - monthlyInterest) < INTEREST_ONLY_TOLERANCE
          ? 0
          : scheduled - monthlyInterest;

      yearInterest += monthlyInterest;
      yearScheduledPayment += scheduled;
      monthsPaidThisYear++;
      yearPrincipal += principalFromPayment;
      bal = Math.max(0, bal - principalFromPayment);

      // Apply per-payment extra after regular payment
      if (bal > 0 && perPaymentExtra > 0) {
        const extra = Math.min(perPaymentExtra, bal);
        yearExtraPayment += extra;
        bal = Math.max(0, bal - extra);
      }

      // Apply lump sum once (first month of the year)
      if (!lumpApplied && lumpSum > 0 && bal > 0) {
        const extra = Math.min(lumpSum, bal);
        yearExtraPayment += extra;
        bal = Math.max(0, bal - extra);
        lumpApplied = true;
      }
    }

    // Contractual end: absorb any rounding dust so the final period
    // always pays the balance to zero rather than leaving a residual
    // from monthly-payment rounding (e.g. $1896.20 stored for a loan
    // whose theoretical payment is $1896.203...).
    if (year === endYear && bal > 0) {
      yearScheduledPayment += bal;
      yearPrincipal += bal;
      bal = 0;
    }

    rows.push({
      year,
      beginningBalance,
      payment: yearScheduledPayment,
      interest: yearInterest,
      principal: yearPrincipal,
      extraPayment: yearExtraPayment,
      endingBalance: bal,
      firstPaymentMonth: year === startYear ? startMonth : 1,
      paymentCount: monthsPaidThisYear,
    });
  }

  return rows;
}
