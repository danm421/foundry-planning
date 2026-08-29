import { rollBenefitBase, resolvePayoutPercent } from "./benefit-base";
import { assertUnitRate, assertFiniteRate } from "./rates";
import {
  splitLifo,
  splitAnnuitized,
  exclusionRatio,
  expectedReturnMultiple,
  earlyWithdrawalPenalty,
} from "./tax";
import type { AnnuityContract, AnnuityState, AnnuityTaxSplit } from "./types";

/** Seed the per-year state from the contract and the account's opening balance. */
export function initAnnuityState(
  contract: AnnuityContract,
  accountValue: number,
): AnnuityState {
  // An unknown cost basis is seeded to the account value, NOT to zero. Zero
  // would invent a fully taxable gain on every legacy contract; value invents
  // none. The UI nags the advisor for the real number.
  const basis = contract.costBasis ?? accountValue;
  return {
    accountValue,
    benefitBase: contract.benefitBase ?? accountValue,
    remainingBasis: basis,
    cumulativeExcluded: 0,
    incomeActive: false,
    guaranteedIncome: 0,
    lockedExclusionRatio: 0,
    investmentInContract: basis,
  };
}

export interface AnnuityYearInput {
  contract: AnnuityContract;
  state: AnnuityState;
  year: number;
  ownerAge: number;
  /** The account's resolved growth rate for this year. */
  growthRate: number;
  /** False once the annuitant has died — drives the survivor rules. */
  isAlive: boolean;
  coAnnuitantAge?: number;
}

export interface AnnuityYearResult {
  /** Gross cash paid to the household this year. */
  income: number;
  ordinaryIncome: number;
  basisReturn: number;
  earlyWithdrawalPenalty: number;
  state: AnnuityState;
}

const ZERO = (state: AnnuityState): AnnuityYearResult => ({
  income: 0, ordinaryIncome: 0, basisReturn: 0, earlyWithdrawalPenalty: 0, state,
});

/**
 * §72(q)/(t) is waived on a distribution made after the owner's death. Only
 * reachable now that a certain term keeps paying past death — and the old path
 * would have charged the penalty against the DECEASED owner's age.
 */
const waivePenaltyAfterDeath = (
  split: AnnuityTaxSplit,
  isAlive: boolean,
): AnnuityTaxSplit => (isAlive ? split : { ...split, earlyWithdrawalPenalty: 0 });

/**
 * Advance one annuity contract by one projection year.
 *
 * Order matters and mirrors how a contract actually works:
 *   1. grow the account value net of fees
 *   2. roll up the benefit base (rider, income off)
 *   3. activate income if the start year has arrived
 *   4. pay this year's income
 *   5. split the payment for tax
 *
 * The defining behavior — and the thing every test must protect — is that in
 * rider mode the income does NOT stop when the account value reaches zero.
 * The carrier keeps paying out of its own pocket. The balance sheet shows $0
 * while the income line continues, which looks like a bug and is not.
 */
export function stepAnnuityYear(input: AnnuityYearInput): AnnuityYearResult {
  const { contract, year, ownerAge, growthRate, isAlive, coAnnuitantAge } = input;
  const state: AnnuityState = { ...input.state };

  const annuitized = contract.incomeMode === "annuitized";
  const started =
    contract.incomeMode !== "none" &&
    contract.incomeStartYear != null &&
    year >= contract.incomeStartYear;

  // ── 1. Accumulation ──────────────────────────────────────────────────────
  // An annuitized contract has no account value left to grow.
  if (!annuitized || !state.incomeActive) {
    // Guard BEFORE the arithmetic. `Math.max(0, NaN)` is `NaN`, so the zero
    // floor below cannot catch bad data — one NaN rate would ride into every
    // tax figure this function returns while still reporting real income.
    assertFiniteRate("growthRate", growthRate);
    assertUnitRate("annualFeePct", contract.annualFeePct);
    const netGrowth = growthRate - contract.annualFeePct;
    state.accountValue = Math.max(0, state.accountValue * (1 + netGrowth));
  }

  // ── 2. Benefit-base rollup + rider fee ───────────────────────────────────
  if (contract.incomeMode === "rider") {
    state.benefitBase = rollBenefitBase({
      contract,
      currentBase: state.benefitBase,
      accountValue: state.accountValue,
      year,
      incomeActive: state.incomeActive,
    });
    // The rider fee is quoted against the BENEFIT BASE but charged to the
    // account value — which is why a big base drains a small account faster.
    // `!= null`, not a truthiness check: NaN is falsy, so `if (riderFeePct)`
    // would skip both the guard and the fee and silently charge nothing.
    if (contract.riderFeePct != null) {
      assertUnitRate("riderFeePct", contract.riderFeePct);
      state.accountValue = Math.max(
        0,
        state.accountValue - state.benefitBase * contract.riderFeePct,
      );
    }
  }

  if (!started) return ZERO(state);

  // ── 3. Activation ────────────────────────────────────────────────────────
  if (!state.incomeActive) {
    state.incomeActive = true;
    // A contract already in force when the projection starts activated in its
    // STATED start year, not in the first year we happen to model. Restarting
    // the clock here would price an existing SPIA off the owner's CURRENT age
    // — a shorter remaining life expectancy, so a higher exclusion ratio and
    // systematically understated late-life taxable income, which is the very
    // error the §72(b)(2) cap exists to prevent. It also sets the period-certain
    // clock, so a term that began in the past correctly has fewer years left.
    const activationYear = contract.incomeStartYear ?? year;
    const yearsInForce = year - activationYear;
    const ageAtActivation = ownerAge - yearsInForce;
    if (annuitized) {
      state.guaranteedIncome = contract.annuitizedPayment ?? 0;
      const years =
        contract.expectedReturnYears ??
        expectedReturnMultiple({
          structure: contract.payoutStructure ?? "single_life",
          ownerAge: ageAtActivation,
          coAnnuitantAge:
            coAnnuitantAge == null ? undefined : coAnnuitantAge - yearsInForce,
          periodCertainYears: contract.periodCertainYears,
        });
      state.lockedExclusionRatio = exclusionRatio(
        state.investmentInContract,
        state.guaranteedIncome * years,
      );
      // §72(b)(2) counts exclusions ALREADY TAKEN, and a contract in payout
      // before the plan starts has been taking them for `yearsInForce` years.
      // Starting the count at 0 lets it exclude its entire investment a SECOND
      // time and pushes the cap out by exactly that many years — a $200k SPIA
      // bought at 65 and modeled from 10 years later stops excluding at 94
      // instead of 84, understating ~$107k of late-life ordinary income. This
      // is the same back-dating the age and the period-certain clock above
      // already do; the cumulative count was the one that was missed.
      state.cumulativeExcluded = Math.min(
        state.investmentInContract,
        state.lockedExclusionRatio * state.guaranteedIncome * yearsInForce,
      );
      // NOTE: the account value is NOT surrendered here — see the guarded
      // surrender below, after this year's payment is known to be real.
    } else {
      state.guaranteedIncome =
        state.benefitBase * resolvePayoutPercent(contract, ageAtActivation);
    }
    state.activationYear = activationYear;
  }

  // ── 4. This year's payment ───────────────────────────────────────────────
  const structure = contract.payoutStructure;

  // Years still owed under a stated certain term. `null` when the contract
  // states no term, or before income begins — NOT zero, so a missing term
  // never reads as an expired one.
  const certainYearsLeft =
    contract.periodCertainYears != null && state.activationYear != null
      ? state.activationYear + contract.periodCertainYears - year
      : null;
  const insideCertainTerm = certainYearsLeft != null && certainYearsLeft > 0;
  const certainTermExpired = certainYearsLeft != null && certainYearsLeft <= 0;

  let payment = state.guaranteedIncome;

  if (!isAlive) {
    // A certain term is NOT life-contingent. Its remaining payments are
    // guaranteed and run on to the beneficiary or the estate — stopping them at
    // death drops money the contract owes, the same failure class as stopping a
    // rider at the crossover.
    const certainTermStillOwed =
      insideCertainTerm &&
      (structure === "period_certain" || structure === "life_with_period_certain");

    if (structure === "joint_survivor") {
      // The one rate that reached arithmetic unguarded. A percent-scaled `50`
      // turns a $10,000 survivor payment into $500,000 with no error anywhere;
      // Zod blocks it on the only write path today, so this is the same
      // defense-in-depth every other rate in this module already has.
      payment =
        state.guaranteedIncome * assertUnitRate("survivorPct", contract.survivorPct ?? 0);
    } else if (!certainTermStillOwed) {
      // single_life, cash_refund, an unstated structure, or a certain term that
      // has already run out: nothing further is owed.
      return ZERO(state);
    }
    // Otherwise the full guaranteed payment stands.
  }

  // A pure period-certain payout stops when its term ends, alive or dead — the
  // term IS the contract. `life_with_period_certain` does not stop here while
  // the annuitant lives: for that structure the certain period is a floor under
  // a lifetime payout, not a ceiling. Once dead, the branch above has already
  // ended it at the term.
  if (structure === "period_certain" && certainTermExpired) return ZERO(state);

  if (payment <= 0) return ZERO(state);

  // Annuitization surrenders the account value to the carrier — but ONLY once a
  // payment is real. This used to run up in the activation block, ABOVE the two
  // guards above, so any annuitized contract that paid nothing in its
  // activation year handed the carrier its whole balance and got nothing back,
  // forever. Two reachable triggers, both of which pass every `== null` guard
  // in the stack (Zod, the DB CHECK, and the form) because they are ZERO, not
  // null: an `annuitizedPayment` of 0, and a period-certain term that ran out
  // before the plan starts. Measured before the fix: a $250,000 SPIA went to $0
  // with $0 of income in every year.
  if (annuitized) state.accountValue = 0;

  // ── 5. Tax split ─────────────────────────────────────────────────────────
  if (contract.taxTreatment === "tax_free") {
    if (!annuitized) state.accountValue = Math.max(0, state.accountValue - payment);
    return {
      income: payment, ordinaryIncome: 0, basisReturn: payment,
      earlyWithdrawalPenalty: 0, state,
    };
  }

  if (contract.taxTreatment === "qualified") {
    // No after-tax basis in a qualified contract — every dollar is OI.
    if (!annuitized) state.accountValue = Math.max(0, state.accountValue - payment);
    // §72(t) via tax.ts rather than a second inline copy of the 59.5/10% rule —
    // two copies of a tax constant is how one of them goes stale.
    return {
      income: payment, ordinaryIncome: payment, basisReturn: 0,
      earlyWithdrawalPenalty: isAlive ? earlyWithdrawalPenalty(payment, ownerAge) : 0,
      state,
    };
  }

  // Non-qualified.
  if (annuitized) {
    const split = waivePenaltyAfterDeath(
      splitAnnuitized({
        payment,
        exclusionRatio: state.lockedExclusionRatio,
        investmentInContract: state.investmentInContract,
        cumulativeExcluded: state.cumulativeExcluded,
        ownerAge,
      }),
      isAlive,
    );
    state.cumulativeExcluded += split.basisReturn;
    state.remainingBasis = Math.max(0, state.remainingBasis - split.basisReturn);
    return { income: payment, ...split, state };
  }

  // Rider income is a WITHDRAWAL, not annuitization — so it is taxed LIFO, not
  // by exclusion ratio. Advisors get this backwards constantly.
  const split = waivePenaltyAfterDeath(
    splitLifo({
      withdrawal: payment,
      accountValue: state.accountValue,
      remainingBasis: state.remainingBasis,
      ownerAge,
    }),
    isAlive,
  );
  state.remainingBasis = Math.max(0, state.remainingBasis - split.basisReturn);
  // Floor at zero — and keep paying. This is the crossover.
  state.accountValue = Math.max(0, state.accountValue - payment);
  return { income: payment, ...split, state };
}
