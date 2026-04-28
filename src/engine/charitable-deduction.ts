/**
 * Charitable-deduction income-tax pass.
 *
 * Lifetime gifts to charities (gifts where recipientExternalBeneficiaryId points at
 * an external_beneficiary with kind='charity') generate an itemized charitable
 * deduction subject to AGI percentage limits per IRC §170(b). Unused deduction
 * carries forward up to 5 years (FIFO).
 *
 * Buckets by (asset class, charity type):
 *   cash → public:        60% AGI limit
 *   cash → private:       30% AGI limit
 *   appreciated → public: 30% AGI limit
 *   appreciated → private: 20% AGI limit
 *
 * Itemize-vs-standard branch: the deduction only flows through if total
 * itemized deductions exceed the standard deduction for the filing status.
 */

import type { CharityCarryforward, CarryforwardEntry } from "./types";

export type CharityBucket =
  | "cashPublic"
  | "cashPrivate"
  | "appreciatedPublic"
  | "appreciatedPrivate";

export interface CharityGiftThisYear {
  amount: number;
  bucket: CharityBucket;
}

export interface ComputeCharitableDeductionInput {
  giftsThisYear: CharityGiftThisYear[];
  agi: number;
  carryforwardIn: CharityCarryforward;
  currentYear: number;
  /** True if the household will itemize this year (Σ itemized > standard for filing status). */
  willItemize: boolean;
}

export interface ComputeCharitableDeductionResult {
  /** Total deduction realized this year (zero if !willItemize). */
  deductionThisYear: number;
  /** Updated carryforward for next year. */
  carryforwardOut: CharityCarryforward;
  /** Per-bucket breakdown of how much was deducted. Useful for diagnostics. */
  byBucket: Record<CharityBucket, number>;
}

const AGI_LIMITS: Record<CharityBucket, number> = {
  cashPublic: 0.6,
  cashPrivate: 0.3,
  appreciatedPublic: 0.3,
  appreciatedPrivate: 0.2,
};

const BUCKET_ORDER: CharityBucket[] = [
  "cashPublic",
  "cashPrivate",
  "appreciatedPublic",
  "appreciatedPrivate",
];

const CARRYFORWARD_MAX_YEARS = 5;

export function computeCharitableDeductionForYear(
  input: ComputeCharitableDeductionInput,
): ComputeCharitableDeductionResult {
  // Implementation lands in Tasks 7-9 (TDD). Placeholder for now.
  return {
    deductionThisYear: 0,
    carryforwardOut: input.carryforwardIn,
    byBucket: {
      cashPublic: 0,
      cashPrivate: 0,
      appreciatedPublic: 0,
      appreciatedPrivate: 0,
    },
  };
}
