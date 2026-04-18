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
  principal: number;
  extraPayment: number;
  endingBalance: number;
}

export interface ScheduleExtraPayment {
  year: number;
  type: "per_payment" | "lump_sum";
  amount: number;
}

/**
 * Full amortization schedule from loan parameters + optional extra payments.
 * Returns one row per year from startYear until payoff or contractual end.
 */
export function computeAmortizationSchedule(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
  startYear: number,
  termMonths: number,
  extraPayments: ScheduleExtraPayment[] = []
): AmortizationScheduleRow[] {
  const endYear = startYear + Math.ceil(termMonths / 12) - 1;
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

    // Simulate 12 months of amortization for this year
    let yearInterest = 0;
    let yearScheduledPayment = 0;
    let yearPrincipal = 0;
    let yearExtraPayment = 0;
    let lumpApplied = false;

    for (let m = 0; m < 12; m++) {
      if (bal <= 0) break;

      const monthlyInterest = bal * r;
      const scheduled = Math.min(monthlyPayment, bal + monthlyInterest);
      const principalFromPayment = Math.max(0, scheduled - monthlyInterest);

      yearInterest += monthlyInterest;
      yearScheduledPayment += scheduled;
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
    });
  }

  return rows;
}
