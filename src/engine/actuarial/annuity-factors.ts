import { lx, survivalProbability } from "./mortality";

const AGE_MAX = 110;

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

export interface SingleLifeAnnuityInput {
  age: number;
  irc7520Rate: number;
}

/**
 * Single-life annuity factor — derivation matching IRS Pub 1457 Table S.
 *
 *   a_x = Σ_{t=1..ω-x} v^t × tpx
 *   where v = 1/(1+r), tpx = l_{x+t}/l_x (2010CM mortality)
 *
 * Multiply by annual payout to get present value of payments-while-alive.
 */
export function singleLifeAnnuityFactor(input: SingleLifeAnnuityInput): number {
  const { age, irc7520Rate } = input;
  if (age < 0 || age > AGE_MAX || !Number.isInteger(age)) {
    throw new Error(`age out of [0, ${AGE_MAX}]: ${age}`);
  }
  if (irc7520Rate <= 0 || irc7520Rate >= 1) {
    throw new Error(`irc7520Rate out of (0,1): ${irc7520Rate}`);
  }
  if (lx(age) === 0) return 0;
  const v = 1 / (1 + irc7520Rate);
  let a = 0;
  const tMax = AGE_MAX - age;
  for (let t = 1; t <= tMax; t++) {
    a += Math.pow(v, t) * survivalProbability(age, t);
  }
  return a;
}
