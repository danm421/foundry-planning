/**
 * Charitable-deduction income-tax pass.
 *
 * Lifetime gifts to charities (gifts where recipientExternalBeneficiaryId points at
 * an external_beneficiary with kind='charity') generate an itemized charitable
 * deduction subject to AGI percentage limits per IRC §170(b). Unused deduction
 * carries forward up to 5 years (FIFO).
 *
 * Buckets by (asset class, charity type), each with a per-bucket AGI sub-cap:
 *   cash → public:        60% AGI limit
 *   cash → private:       30% AGI limit
 *   appreciated → public: 30% AGI limit
 *   appreciated → private: 20% AGI limit
 *
 * §170(b)(1): these sub-caps share an overall AGI ceiling — the categories do
 * NOT each get a fresh slice of full AGI. We apply the conservative single
 * 60%-of-AGI overall ceiling: cash-to-public consumes the ceiling first and
 * crowds out the 30%/20% property categories, so the aggregate deduction in any
 * one year cannot exceed 60% of AGI (overflow carries forward). A fully precise
 * impl would split this into a 60% cash pool and a separate 50% pool with a 30%
 * sub-cap for appreciated property; the single-ceiling version is the agreed
 * conservative fix that eliminates the >100%-of-AGI over-deduction.
 *
 * Itemize-vs-standard branch: this function computes the deduction assuming the
 * household itemizes. The standard-deduction case is handled separately by
 * computeCharitableNoItemize (F23), which preserves the carryforward instead of
 * consuming it. The caller (year-tax.ts) elects between the two.
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
}

export interface ComputeCharitableDeductionResult {
  /** Total deduction realized this year, assuming the household itemizes. */
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
  const { giftsThisYear, agi, carryforwardIn, currentYear } = input;

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

  // §170(b)(1) — the per-bucket AGI ceilings share an overall AGI ceiling; they
  // are NOT each entitled to a fresh slice of full AGI. cashPublic (first in
  // BUCKET_ORDER) is the only category entitled to the 60% headroom, so the
  // overall ceiling is 60% × AGI and every deducted dollar — carryforward or
  // this-year gift — draws down the shared pool. This is the conservative
  // single-60%-ceiling model: it eliminates the >100%-of-AGI over-deduction
  // while keeping each bucket's own sub-cap (AGI_LIMITS[bucket] × AGI) via min().
  const overallCeiling = 0.6 * agi;
  let overallRemaining = overallCeiling;

  for (const bucket of BUCKET_ORDER) {
    const remainingCapacity = Math.min(AGI_LIMITS[bucket] * agi, overallRemaining);
    let bucketRemaining = remainingCapacity;

    // Consume carryforward FIFO (oldest first)
    const cf = carryforwardWorking[bucket];
    while (cf.length > 0 && bucketRemaining > 0) {
      const head = cf[0];
      const consume = Math.min(head.amount, bucketRemaining);
      bucketRemaining -= consume;
      overallRemaining -= consume;
      head.amount -= consume;
      deductionThisYear += consume;
      byBucket[bucket] += consume;
      if (head.amount === 0) {
        cf.shift();
      }
    }

    // Then consume this-year gift
    const giftThisYear = giftsByBucket[bucket];
    const deductFromGift = Math.min(giftThisYear, bucketRemaining);
    overallRemaining -= deductFromGift;
    deductionThisYear += deductFromGift;
    byBucket[bucket] += deductFromGift;
    const overflow = giftThisYear - deductFromGift;

    if (overflow > 0) {
      cf.push({ amount: overflow, originYear: currentYear });
    }
  }

  return { deductionThisYear, carryforwardOut: carryforwardWorking, byBucket };
}

/**
 * Standard-deduction branch (F23 fix). When the household takes the standard
 * deduction, NO charitable deduction is realized and — critically — NO
 * carryforward is consumed: a deduction can only be "used" against an itemized
 * return. The correct carryforward treatment is therefore (a) decay/expire prior
 * entries by age and (b) APPEND this year's gifts in full so they remain
 * available in a future itemizing year. The old in-line `willItemize:false`
 * branch wrongly ran the full FIFO consumption loop first, shifting consumed
 * dollars out of the carryforward even though nothing was deducted.
 */
export function computeCharitableNoItemize(input: {
  giftsThisYear: CharityGiftThisYear[];
  carryforwardIn: CharityCarryforward;
  currentYear: number;
}): ComputeCharitableDeductionResult {
  const { giftsThisYear, carryforwardIn, currentYear } = input;
  const carryforwardOut: CharityCarryforward = {
    cashPublic: dropExpired(carryforwardIn.cashPublic, currentYear).map(cloneEntry),
    cashPrivate: dropExpired(carryforwardIn.cashPrivate, currentYear).map(cloneEntry),
    appreciatedPublic: dropExpired(carryforwardIn.appreciatedPublic, currentYear).map(cloneEntry),
    appreciatedPrivate: dropExpired(carryforwardIn.appreciatedPrivate, currentYear).map(cloneEntry),
  };
  for (const g of giftsThisYear) {
    carryforwardOut[g.bucket].push({ amount: g.amount, originYear: currentYear });
  }
  return { deductionThisYear: 0, carryforwardOut, byBucket: emptyByBucket() };
}

function emptyByBucket(): Record<CharityBucket, number> {
  return { cashPublic: 0, cashPrivate: 0, appreciatedPublic: 0, appreciatedPrivate: 0 };
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
