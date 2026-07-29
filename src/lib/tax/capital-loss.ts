// src/lib/tax/capital-loss.ts
//
// IRC §1222 netting → §1211(b) ordinary-offset cap → §1212(b) carryforward.
// Pure: no I/O, no engine imports.
//
// Split into two functions on purpose. Netting (steps 1-4) does not depend on
// taxable income, but the §1212(b)(2) carryover test does — and taxable income
// depends on the deduction netting produces. A single function would be
// circular. This mirrors Form 1040: Schedule D → line 7 → AGI → taxable
// income → then the Capital Loss Carryover Worksheet.

import type { FilingStatus } from "./types";
import {
  CAPITAL_LOSS_ORDINARY_LIMIT,
  CAPITAL_LOSS_ORDINARY_LIMIT_MFS,
} from "./constants";

/** Unused capital loss carried between years. Both fields are non-negative
 *  MAGNITUDES — `longTerm: 5000` means $5,000 of long-term LOSS. */
export interface CapitalLossCarryforward {
  shortTerm: number;
  longTerm: number;
}

export function emptyCapitalLossCarryforward(): CapitalLossCarryforward {
  return { shortTerm: 0, longTerm: 0 };
}

export interface CapitalLossNettingInput {
  /** Signed gross long-term gain for the year; negative means a loss. */
  longTermGain: number;
  /** Signed gross short-term gain for the year; negative means a loss. */
  shortTermGain: number;
  carryforwardIn: CapitalLossCarryforward;
  filingStatus: FilingStatus;
}

export interface CapitalLossNettingResult {
  /** Net long-term gain, >= 0. Feeds the §1(h) preferential-rate calc. */
  netLongTermGain: number;
  /** Net short-term gain, >= 0. Taxed as ordinary income. */
  netShortTermGain: number;
  /** §1211(b) deduction against ordinary income, >= 0. NOT limited by
   *  taxable income — see computeCarryforwardOut. */
  capitalLossDeduction: number;
  /** Unabsorbed short-term loss magnitude before the §1212(b)(2) test. */
  shortTermLoss: number;
  /** Unabsorbed long-term loss magnitude before the §1212(b)(2) test. */
  longTermLoss: number;
}

/** Steps 1-4: seed carryforward by character, net within character, cross-net,
 *  apply the §1211(b) cap. */
export function netCapitalGainsAndLosses(
  input: CapitalLossNettingInput,
): CapitalLossNettingResult {
  // 1. §1212(b)(1): prior-year carryforward enters as a loss of its own
  //    character. Holding period is never re-tested.
  let netShort = input.shortTermGain - input.carryforwardIn.shortTerm;
  let netLong = input.longTermGain - input.carryforwardIn.longTerm;

  // 2-3. §1222: netting within character is the subtraction above; now
  //      cross-net when the two carry opposite signs. A net short-term loss
  //      shelters long-term gain and vice versa. At most one side stays
  //      negative afterwards, and the other is then exactly 0.
  if (netShort < 0 && netLong > 0) {
    const offset = Math.min(-netShort, netLong);
    netShort += offset;
    netLong -= offset;
  } else if (netLong < 0 && netShort > 0) {
    const offset = Math.min(-netLong, netShort);
    netLong += offset;
    netShort -= offset;
  }

  const shortTermLoss = netShort < 0 ? -netShort : 0;
  const longTermLoss = netLong < 0 ? -netLong : 0;

  // 4. §1211(b): the net capital loss offsets ordinary income, capped.
  const limit =
    input.filingStatus === "married_separate"
      ? CAPITAL_LOSS_ORDINARY_LIMIT_MFS
      : CAPITAL_LOSS_ORDINARY_LIMIT;
  const capitalLossDeduction = Math.min(shortTermLoss + longTermLoss, limit);

  return {
    netLongTermGain: Math.max(0, netLong),
    netShortTermGain: Math.max(0, netShort),
    capitalLossDeduction,
    shortTermLoss,
    longTermLoss,
  };
}

/** Steps 5-6: §1212(b)(2) consumption test, then §1212(b) carryforward with
 *  the deduction absorbed against SHORT-term loss first.
 *
 *  `taxableIncomeBeforeCapitalLossDeduction` is taxable income computed as if
 *  the deduction had not been taken, UNFLOORED (callers must not clamp it to
 *  zero first — this function clamps). A year can legitimately take a $3,000
 *  deduction while consuming $0 of carryforward. */
export function computeCarryforwardOut(
  netting: CapitalLossNettingResult,
  taxableIncomeBeforeCapitalLossDeduction: number,
): { carryforwardOut: CapitalLossCarryforward; carryforwardConsumed: number } {
  const carryforwardConsumed = Math.min(
    netting.capitalLossDeduction,
    Math.max(0, taxableIncomeBeforeCapitalLossDeduction),
  );

  // §1212(b): short-term loss is absorbed first, then long-term.
  const shortConsumed = Math.min(netting.shortTermLoss, carryforwardConsumed);
  const longConsumed = Math.min(
    netting.longTermLoss,
    carryforwardConsumed - shortConsumed,
  );

  return {
    carryforwardConsumed,
    carryforwardOut: {
      shortTerm: netting.shortTermLoss - shortConsumed,
      longTerm: netting.longTermLoss - longConsumed,
    },
  };
}
