import { rollBenefitBase, resolvePayoutPercent } from "./benefit-base";
import {
  splitLifo,
  splitAnnuitized,
  exclusionRatio,
  expectedReturnMultiple,
  earlyWithdrawalPenalty,
} from "./tax";
import type { AnnuityContract, AnnuityState } from "./types";

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
    if (contract.riderFeePct) {
      state.accountValue = Math.max(0, state.accountValue - state.benefitBase * contract.riderFeePct);
    }
  }

  if (!started) return ZERO(state);

  // ── 3. Activation ────────────────────────────────────────────────────────
  if (!state.incomeActive) {
    state.incomeActive = true;
    if (annuitized) {
      state.guaranteedIncome = contract.annuitizedPayment ?? 0;
      const years =
        contract.expectedReturnYears ??
        expectedReturnMultiple({
          structure: contract.payoutStructure ?? "single_life",
          ownerAge,
          coAnnuitantAge,
          periodCertainYears: contract.periodCertainYears,
        });
      state.lockedExclusionRatio = exclusionRatio(
        state.investmentInContract,
        state.guaranteedIncome * years,
      );
      // Annuitization surrenders the account value to the carrier.
      state.accountValue = 0;
    } else {
      state.guaranteedIncome = state.benefitBase * resolvePayoutPercent(contract, ownerAge);
    }
    state.activationYear = year;
  }

  // ── 4. This year's payment ───────────────────────────────────────────────
  let payment = state.guaranteedIncome;

  if (!isAlive) {
    if (contract.payoutStructure === "joint_survivor") {
      payment = state.guaranteedIncome * (contract.survivorPct ?? 0);
    } else {
      return ZERO(state);
    }
  }

  // A pure period-certain term stops on schedule. `life_with_period_certain`
  // deliberately does NOT stop here: for that structure the certain period is a
  // floor, not a ceiling — it keeps paying for life, and death is handled above.
  if (
    contract.payoutStructure === "period_certain" &&
    contract.periodCertainYears != null &&
    state.activationYear != null &&
    year - state.activationYear >= contract.periodCertainYears
  ) {
    return ZERO(state);
  }

  if (payment <= 0) return ZERO(state);

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
      earlyWithdrawalPenalty: earlyWithdrawalPenalty(payment, ownerAge), state,
    };
  }

  // Non-qualified.
  if (annuitized) {
    const split = splitAnnuitized({
      payment,
      exclusionRatio: state.lockedExclusionRatio,
      investmentInContract: state.investmentInContract,
      cumulativeExcluded: state.cumulativeExcluded,
      ownerAge,
    });
    state.cumulativeExcluded += split.basisReturn;
    state.remainingBasis = Math.max(0, state.remainingBasis - split.basisReturn);
    return { income: payment, ...split, state };
  }

  // Rider income is a WITHDRAWAL, not annuitization — so it is taxed LIFO, not
  // by exclusion ratio. Advisors get this backwards constantly.
  const split = splitLifo({
    withdrawal: payment,
    accountValue: state.accountValue,
    remainingBasis: state.remainingBasis,
    ownerAge,
  });
  state.remainingBasis = Math.max(0, state.remainingBasis - split.basisReturn);
  // Floor at zero — and keep paying. This is the crossover.
  state.accountValue = Math.max(0, state.accountValue - payment);
  return { income: payment, ...split, state };
}
