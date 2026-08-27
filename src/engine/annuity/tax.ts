import { survivalProbability } from "../actuarial/mortality";
import type { AnnuityPayoutStructure, AnnuityTaxSplit } from "./types";

const EARLY_WITHDRAWAL_AGE = 59.5;
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10;

/** §72(q) for non-qualified / §72(t) for qualified — same 10% rate, same age.
 *  Charged on the TAXABLE slice only; a pure return of basis is never penalized. */
export function earlyWithdrawalPenalty(taxableAmount: number, ownerAge: number): number {
  if (ownerAge >= EARLY_WITHDRAWAL_AGE) return 0;
  if (taxableAmount <= 0) return 0;
  return taxableAmount * EARLY_WITHDRAWAL_PENALTY_RATE;
}

export interface LifoInput {
  withdrawal: number;
  accountValue: number;
  /** Unrecovered §72 basis. */
  remainingBasis: number;
  ownerAge: number;
}

/**
 * §72(e)(2)(B): a non-annuitized withdrawal from a deferred annuity comes out
 * of EARNINGS FIRST. Basis is returned only after the entire gain is exhausted.
 *
 * ⚠️ This is the exact opposite of the Roth branch in `withdrawal.ts`, which is
 * basis-first, and of the taxable-brokerage branch, which is pro-rata with a
 * capital-gain character. An annuity is gain-first and ORDINARY. Do not
 * "harmonize" this with its neighbors.
 */
export function splitLifo(input: LifoInput): AnnuityTaxSplit {
  const { withdrawal, accountValue, remainingBasis, ownerAge } = input;
  if (withdrawal <= 0) {
    return { ordinaryIncome: 0, basisReturn: 0, earlyWithdrawalPenalty: 0 };
  }
  // An underwater contract has no gain. It never produces a deductible loss —
  // unlike a taxable brokerage draw, whose gain ratio is signed.
  const gain = Math.max(0, accountValue - remainingBasis);
  const fromGain = Math.min(withdrawal, gain);
  const fromBasis = Math.min(withdrawal - fromGain, Math.max(0, remainingBasis));
  // Anything left is the insurer paying past the contract's own value — there is
  // no basis left to recover, so it is ordinary income. This is the living case
  // for an income rider that has drained the account to zero: the guaranteed
  // payments keep coming out of the carrier's pocket, and every dollar of them
  // is taxable. Capping basisReturn at remainingBasis is what makes that true;
  // an uncapped `withdrawal - fromGain` would score those payments tax-free.
  const excess = withdrawal - fromGain - fromBasis;
  const ordinaryIncome = fromGain + excess;
  const basisReturn = fromBasis;
  return {
    ordinaryIncome,
    basisReturn,
    earlyWithdrawalPenalty: earlyWithdrawalPenalty(ordinaryIncome, ownerAge),
  };
}

/** §72(b): investment in the contract ÷ expected return. Capped at 1 — a
 *  contract cannot exclude more than it pays. */
export function exclusionRatio(investmentInContract: number, expectedReturn: number): number {
  if (expectedReturn <= 0) return 0;
  return Math.min(1, investmentInContract / expectedReturn);
}

export interface AnnuitizedInput {
  payment: number;
  /** Locked at the annuity starting date. */
  exclusionRatio: number;
  /** The original investment, frozen — the §72(b)(2) ceiling. */
  investmentInContract: number;
  /** Tax-free dollars already excluded across all prior payments. */
  cumulativeExcluded: number;
  ownerAge: number;
}

/**
 * Splits one annuitized payment. The exclusion is capped by §72(b)(2): once
 * cumulative exclusions equal the investment in the contract, the exclusion
 * stops and every later payment is 100% taxable.
 *
 * On a life annuity for a 65-year-old this bites around age 85 — inside the
 * plan horizon. Dropping the cap silently understates late-life tax, which is
 * exactly where an annuity plan is most sensitive.
 */
export function splitAnnuitized(input: AnnuitizedInput): AnnuityTaxSplit {
  const { payment, exclusionRatio: ratio, investmentInContract, cumulativeExcluded, ownerAge } = input;
  if (payment <= 0) {
    return { ordinaryIncome: 0, basisReturn: 0, earlyWithdrawalPenalty: 0 };
  }
  const headroom = Math.max(0, investmentInContract - cumulativeExcluded);
  const basisReturn = Math.min(payment * ratio, headroom);
  const ordinaryIncome = payment - basisReturn;
  return {
    ordinaryIncome,
    basisReturn,
    earlyWithdrawalPenalty: earlyWithdrawalPenalty(ordinaryIncome, ownerAge),
  };
}

export interface ExpectedReturnInput {
  structure: AnnuityPayoutStructure;
  ownerAge: number;
  coAnnuitantAge?: number;
  periodCertainYears?: number | null;
}

const MAX_MULTIPLE_YEARS = 60;

/** Curtate life expectancy: Σ_{t=1..∞} tPx, off the 2010CM table.
 *  `age` must already be an integer — see the flooring note in the caller. */
function curtateLifeExpectancy(age: number): number {
  let sum = 0;
  for (let t = 1; t <= MAX_MULTIPLE_YEARS; t++) {
    sum += survivalProbability(age, t);
  }
  return sum;
}

/**
 * The §72 expected-return multiple — how many years of payments the contract
 * is expected to make.
 *
 * Reg. §1.72-9 Tables V/VI are built on an older mortality basis than the
 * 2010CM table Foundry carries, so this is a close approximation rather than
 * a table lookup. The advisor can override it with the contract's actual
 * figure via `expectedReturnYears`, which is why the override exists.
 */
export function expectedReturnMultiple(input: ExpectedReturnInput): number {
  const { structure, periodCertainYears } = input;

  // The mortality table is indexed by INTEGER age: `lx(65.5)` reads past the
  // array and returns undefined, so survivalProbability yields NaN. NaN then
  // slips every guard downstream — `Math.max(1, NaN)` is NaN, and a NaN
  // expectedReturn slips `exclusionRatio`'s `expectedReturn <= 0` check — so
  // every payment's split would go NaN with no error anywhere. The projection
  // passes an integer age today, but this module's own earlyWithdrawalPenalty
  // takes 59.5, which invites a fractional age from the very next caller.
  // Floor both ages here, at the one place they meet the table.
  const ownerAge = Math.floor(input.ownerAge);
  const coAnnuitantAge =
    input.coAnnuitantAge == null ? undefined : Math.floor(input.coAnnuitantAge);

  if (structure === "period_certain") {
    if (periodCertainYears != null && periodCertainYears > 0) {
      return Math.max(1, periodCertainYears);
    }
    // A missing or non-positive term is a DATA GAP, not a one-year contract —
    // periodCertainYears is nullable in both AnnuityContract and the DB column.
    // Returning 1 would pin the exclusion ratio at 1.0 and hand the advisor a
    // 100%-tax-free income stream until §72(b)(2) bites, turning a blank field
    // into tax-free income. Life expectancy is a far better guess for a term
    // nobody filled in.
    return Math.max(1, curtateLifeExpectancy(ownerAge));
  }

  const single = curtateLifeExpectancy(ownerAge);

  if (structure === "joint_survivor" && coAnnuitantAge != null) {
    // Last-survivor expectancy: Σ (1 − (1−tPx)(1−tPy)). Always ≥ either single
    // life, which is what makes a joint payout's per-payment exclusion smaller.
    let joint = 0;
    for (let t = 1; t <= MAX_MULTIPLE_YEARS; t++) {
      const px = survivalProbability(ownerAge, t);
      const py = survivalProbability(coAnnuitantAge, t);
      joint += 1 - (1 - px) * (1 - py);
    }
    return Math.max(1, joint);
  }

  if (structure === "life_with_period_certain" || structure === "cash_refund") {
    // Payments run for at least the certain period, then for life.
    return Math.max(1, single, periodCertainYears ?? 0);
  }

  return Math.max(1, single);
}
