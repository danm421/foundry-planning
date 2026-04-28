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
  const { giftsThisYear, agi, carryforwardIn, currentYear, willItemize } = input;

  const byBucket: Record<CharityBucket, number> = {
    cashPublic: 0,
    cashPrivate: 0,
    appreciatedPublic: 0,
    appreciatedPrivate: 0,
  };

  const giftsByBucket: Record<CharityBucket, number> = {
    cashPublic: 0,
    cashPrivate: 0,
    appreciatedPublic: 0,
    appreciatedPrivate: 0,
  };
  for (const g of giftsThisYear) {
    giftsByBucket[g.bucket] += g.amount;
  }

  // Decay: drop carryforward entries older than CARRYFORWARD_MAX_YEARS
  const carryforwardWorking: Record<CharityBucket, CarryforwardEntry[]> = {
    cashPublic: dropExpired(carryforwardIn.cashPublic, currentYear).map(cloneEntry),
    cashPrivate: dropExpired(carryforwardIn.cashPrivate, currentYear).map(cloneEntry),
    appreciatedPublic: dropExpired(carryforwardIn.appreciatedPublic, currentYear).map(cloneEntry),
    appreciatedPrivate: dropExpired(carryforwardIn.appreciatedPrivate, currentYear).map(cloneEntry),
  };

  let deductionThisYear = 0;

  for (const bucket of BUCKET_ORDER) {
    const limit = AGI_LIMITS[bucket] * agi;
    let remainingCapacity = limit;

    // Consume carryforward FIFO (oldest first)
    const cf = carryforwardWorking[bucket];
    while (cf.length > 0 && remainingCapacity > 0) {
      const head = cf[0];
      const consume = Math.min(head.amount, remainingCapacity);
      remainingCapacity -= consume;
      head.amount -= consume;
      deductionThisYear += consume;
      byBucket[bucket] += consume;
      if (head.amount === 0) {
        cf.shift();
      }
    }

    // Then consume this-year gift
    const giftThisYear = giftsByBucket[bucket];
    const deductFromGift = Math.min(giftThisYear, remainingCapacity);
    deductionThisYear += deductFromGift;
    byBucket[bucket] += deductFromGift;
    const overflow = giftThisYear - deductFromGift;

    if (overflow > 0) {
      cf.push({ amount: overflow, originYear: currentYear });
    }
  }

  if (!willItemize) {
    return {
      deductionThisYear: 0,
      carryforwardOut: carryforwardWorking,
      byBucket: {
        cashPublic: 0,
        cashPrivate: 0,
        appreciatedPublic: 0,
        appreciatedPrivate: 0,
      },
    };
  }

  return { deductionThisYear, carryforwardOut: carryforwardWorking, byBucket };
}

function dropExpired(
  entries: CarryforwardEntry[],
  currentYear: number,
): CarryforwardEntry[] {
  return entries.filter(
    (e) => currentYear - e.originYear <= CARRYFORWARD_MAX_YEARS,
  );
}

function cloneEntry(e: CarryforwardEntry): CarryforwardEntry {
  return { amount: e.amount, originYear: e.originYear };
}
