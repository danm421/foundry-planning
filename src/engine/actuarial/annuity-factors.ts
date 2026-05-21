export interface TermCertainAnnuityInput {
  irc7520Rate: number;
  termYears: number;
}

/**
 * Term-certain annuity factor — IRS Pub 1457 Table B.
 *
 *   a_n = (1 - v^n) / r
 *   where v = 1 / (1 + r), r = §7520 rate
 *
 * Multiply by the annual payout dollar amount to get the present value of
 * the lead (income) interest going to charity in a CLAT.
 */
export function termCertainAnnuityFactor(input: TermCertainAnnuityInput): number {
  const { irc7520Rate, termYears } = input;
  if (irc7520Rate <= 0 || irc7520Rate >= 1) {
    throw new Error(`irc7520Rate out of (0,1): ${irc7520Rate}`);
  }
  if (termYears < 1 || !Number.isInteger(termYears)) {
    throw new Error(`termYears must be a positive integer: ${termYears}`);
  }
  const v = 1 / (1 + irc7520Rate);
  return (1 - Math.pow(v, termYears)) / irc7520Rate;
}
