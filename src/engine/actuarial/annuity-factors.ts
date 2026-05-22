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
 * Single-life annuity factor — IRS Pub 1457 Table S.
 *
 * Per Treas. Reg. §20.2031-7(d)(2)(ii)(B):
 *
 *   a_x = (1 - A_x) / i
 *
 * where A_x is the EOY-of-death life-insurance factor (Σ v^t × q_x(t-1,t))
 * and i is the §7520 interest rate. This UDD-based formulation matches the
 * factors published in Pub 1457 Table S; a direct Σ v^t × tp_x summation
 * understates the factor by ~4-5% at common ages.
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
  const A = lifeInsuranceFactor(age, irc7520Rate);
  return (1 - A) / irc7520Rate;
}

/** A_x = Σ v^t × Pr(death between age x+t-1 and x+t). EOY-of-death convention. */
function lifeInsuranceFactor(age: number, irc7520Rate: number): number {
  const lxAge = lx(age);
  if (lxAge === 0) return 0;
  const v = 1 / (1 + irc7520Rate);
  let A = 0;
  const tMax = AGE_MAX - age;
  for (let t = 1; t <= tMax; t++) {
    const deathInYearT = (lx(age + t - 1) - lx(age + t)) / lxAge;
    A += Math.pow(v, t) * deathInYearT;
  }
  return A;
}

export interface JointLifeAnnuityInput {
  age1: number;
  age2: number;
  irc7520Rate: number;
}

/**
 * Joint-life (last-survivor) annuity factor — Pub 1457-aligned.
 *
 *   a_xy = (1 - A_xy^last) / i
 *
 * where A_xy^last is the last-survivor death-benefit factor under
 * independent-lives (consistent with IRS Table R(2)):
 *
 *   A_xy^last = Σ v^t × Pr(last survivor dies in year t)
 *   Pr(last dies year t) = P(both dead by t) - P(both dead by t-1)
 */
export function jointLifeAnnuityFactor(input: JointLifeAnnuityInput): number {
  const { age1, age2, irc7520Rate } = input;
  for (const a of [age1, age2]) {
    if (a < 0 || a > AGE_MAX || !Number.isInteger(a)) {
      throw new Error(`age out of [0, ${AGE_MAX}]: ${a}`);
    }
  }
  if (irc7520Rate <= 0 || irc7520Rate >= 1) {
    throw new Error(`irc7520Rate out of (0,1): ${irc7520Rate}`);
  }
  const v = 1 / (1 + irc7520Rate);
  const tMax = AGE_MAX - Math.min(age1, age2);
  let A = 0;
  let prevDeadJoint = 0;
  for (let t = 1; t <= tMax; t++) {
    const tp1 = survivalProbability(age1, t);
    const tp2 = survivalProbability(age2, t);
    const deadJoint = (1 - tp1) * (1 - tp2);
    A += Math.pow(v, t) * (deadJoint - prevDeadJoint);
    prevDeadJoint = deadJoint;
  }
  return (1 - A) / irc7520Rate;
}

export interface ShorterOfAnnuityInput {
  age: number;
  termYears: number;
  irc7520Rate: number;
}

/**
 * Shorter-of-N-years-or-life annuity factor — Pub 1457-aligned via the
 * deferred-annuity decomposition:
 *
 *   a_{x:n|} = a_x − v^n × n_p_x × a_{x+n}
 *
 * Both single-life pieces use the Pub 1457 (1 − A_x)/i form. Payments stop
 * when EITHER n years pass OR the measuring life dies.
 */
export function shorterOfYearsOrLifeAnnuityFactor(
  input: ShorterOfAnnuityInput,
): number {
  const { age, termYears, irc7520Rate } = input;
  if (age < 0 || age > AGE_MAX || !Number.isInteger(age)) {
    throw new Error(`age out of [0, ${AGE_MAX}]: ${age}`);
  }
  if (termYears < 1 || !Number.isInteger(termYears)) {
    throw new Error(`termYears must be a positive integer: ${termYears}`);
  }
  if (irc7520Rate <= 0 || irc7520Rate >= 1) {
    throw new Error(`irc7520Rate out of (0,1): ${irc7520Rate}`);
  }
  const a_x = singleLifeAnnuityFactor({ age, irc7520Rate });
  const ageAtTermEnd = age + termYears;
  if (ageAtTermEnd >= AGE_MAX) return a_x;
  const Npx = survivalProbability(age, termYears);
  if (Npx === 0) return a_x;
  const v = 1 / (1 + irc7520Rate);
  const a_xN = singleLifeAnnuityFactor({ age: ageAtTermEnd, irc7520Rate });
  return a_x - Math.pow(v, termYears) * Npx * a_xN;
}
