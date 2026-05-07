import { lx, survivalProbability, deathProbability } from "./mortality";

const AGE_MAX = 110;

export interface TermCertainInput {
  payoutPercent: number;   // unitrust % e.g. 0.06
  termYears: number;       // integer >= 1
}

export interface SingleLifeInput {
  age: number;             // integer 0-110
  payoutPercent: number;
  irc7520Rate: number;     // currently informational; not used in unitrust math
                           // when payments are annual + immediate (Table F factor = 1)
}

export interface JointLifeInput {
  age1: number;
  age2: number;
  payoutPercent: number;
  irc7520Rate: number;
}

export interface ShorterOfInput {
  age: number;
  termYears: number;
  payoutPercent: number;
  irc7520Rate: number;
}

/**
 * Term-certain unitrust remainder factor.
 *
 * For annual valuation + annual immediate payment, Table F adjustment factor = 1,
 * so adjusted payout j = p directly. Then per Treas. Reg. §20.2031-7 Table D:
 *
 *   R = (1 - j)^n
 */
export function termCertainRemainderFactor(input: TermCertainInput): number {
  const { payoutPercent, termYears } = input;
  if (payoutPercent < 0 || payoutPercent > 1) {
    throw new Error(`payoutPercent out of [0,1]: ${payoutPercent}`);
  }
  if (termYears < 1 || !Number.isInteger(termYears)) {
    throw new Error(`termYears must be a positive integer: ${termYears}`);
  }
  return Math.pow(1 - payoutPercent, termYears);
}

/**
 * Single-life unitrust remainder factor.
 *
 * Direct summation over Table 2010CM:
 *   R = sum_{t=1..AGE_MAX-x} deathProb(x, t) * (1 - j)^t
 *     + survivalProb(x, AGE_MAX-x) * (1 - j)^(AGE_MAX-x)
 *
 * The trailing survival term handles the (small) probability of surviving past
 * the terminal age — treated as if death occurred at AGE_MAX.
 */
export function singleLifeRemainderFactor(input: SingleLifeInput): number {
  const { age, payoutPercent } = input;
  if (age < 0 || age > AGE_MAX || !Number.isInteger(age)) {
    throw new Error(`age out of [0, ${AGE_MAX}]: ${age}`);
  }
  if (payoutPercent < 0 || payoutPercent > 1) {
    throw new Error(`payoutPercent out of [0,1]: ${payoutPercent}`);
  }
  if (lx(age) === 0) return 1; // already dead → no payments → full remainder

  const j = payoutPercent;
  let R = 0;
  const tMax = AGE_MAX - age;
  for (let t = 1; t <= tMax; t++) {
    R += deathProbability(age, t) * Math.pow(1 - j, t);
  }
  // Trailing survival to AGE_MAX (in case lx(AGE_MAX) > 0)
  R += survivalProbability(age, tMax) * Math.pow(1 - j, tMax);
  return R;
}

/**
 * Joint-life (last-survivor) unitrust remainder factor.
 *
 * Independent-lives assumption (consistent with IRS Table U(2)).
 * Last-survivor death-by-time-t probability:
 *   q_{xy,t} = (1 - tpx) * (1 - tpy) - (1 - (t-1)px) * (1 - (t-1)py)
 * survival-beyond-t for last survivor:
 *   tpxy = 1 - (1 - tpx) * (1 - tpy)
 */
export function jointLifeRemainderFactor(input: JointLifeInput): number {
  const { age1, age2, payoutPercent } = input;
  for (const a of [age1, age2]) {
    if (a < 0 || a > AGE_MAX || !Number.isInteger(a)) {
      throw new Error(`age out of [0, ${AGE_MAX}]: ${a}`);
    }
  }
  if (payoutPercent < 0 || payoutPercent > 1) {
    throw new Error(`payoutPercent out of [0,1]: ${payoutPercent}`);
  }

  const j = payoutPercent;
  const tMax = AGE_MAX - Math.min(age1, age2);
  let R = 0;
  let prevDeadJoint = 0; // P(both dead by time t-1)
  for (let t = 1; t <= tMax; t++) {
    const tp1 = survivalProbability(age1, t);
    const tp2 = survivalProbability(age2, t);
    const deadJoint = (1 - tp1) * (1 - tp2); // P(both dead by time t)
    const lastSurvivorDiesInYearT = deadJoint - prevDeadJoint;
    R += lastSurvivorDiesInYearT * Math.pow(1 - j, t);
    prevDeadJoint = deadJoint;
  }
  // Trailing survival of either life past tMax
  const survivorBeyond = 1 - prevDeadJoint;
  R += survivorBeyond * Math.pow(1 - j, tMax);
  return R;
}

/**
 * Shorter-of-N-years-or-life unitrust remainder factor.
 *
 * Payments stop when EITHER N years pass OR the measuring life dies.
 *
 *   R = sum_{t=1..N} deathProb(x, t) * (1 - j)^t
 *     + survivalProb(x, N) * (1 - j)^N
 */
export function shorterOfYearsOrLifeRemainderFactor(input: ShorterOfInput): number {
  const { age, termYears, payoutPercent } = input;
  if (termYears < 1 || !Number.isInteger(termYears)) {
    throw new Error(`termYears must be a positive integer: ${termYears}`);
  }
  if (age < 0 || age > AGE_MAX || !Number.isInteger(age)) {
    throw new Error(`age out of [0, ${AGE_MAX}]: ${age}`);
  }

  const j = payoutPercent;
  let R = 0;
  for (let t = 1; t <= termYears; t++) {
    R += deathProbability(age, t) * Math.pow(1 - j, t);
  }
  R += survivalProbability(age, termYears) * Math.pow(1 - j, termYears);
  return R;
}
