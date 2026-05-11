import type { Account, AccountLedger, RothConversion } from "./types";
import type { BracketTier, FilingStatus } from "@/lib/tax/types";
import { classifyTransferTax } from "./tax-classification";
import { controllingFamilyMember } from "./ownership";

// ============================================================================
// Public Types
// ============================================================================

export interface RothConversionsInput {
  conversions: RothConversion[];
  accounts: Account[];
  /** Mutable. Decremented for sources, incremented for the destination. */
  accountBalances: Record<string, number>;
  /** Mutable. Updated proportionally as basis moves with each conversion slice. */
  basisMap: Record<string, number>;
  /** Mutable. For 401k/403b sources: the Roth-designated portion of the
   *  source decrements pro-rata on each conversion slice. The Roth slice is
   *  also added to the destination's basis (already-taxed dollars on a Roth
   *  IRA destination). */
  rothValueMap?: Record<string, number>;
  /** Mutable. Withdrawal/contribution entries added per slice. */
  accountLedgers: Record<string, AccountLedger>;
  year: number;
  ownerAges: { client: number; spouse?: number };
  spouseFamilyMemberId?: string | null;

  // ── Inputs needed for "fill_up_bracket" only ──────────────────────────────
  /** Bracket tiers for this year (already inflation-adjusted by caller). */
  ordinaryBrackets?: BracketTier[];
  /** Preferred: closure returning the year's `incomeTaxBase` given a
   *  hypothetical Roth-conversion taxable amount. The strategy iterates the
   *  closure to converge `incomeTaxBase ≈ tier.to`, which correctly accounts
   *  for Social-Security taxability stack-up, above-line deductions, QBI, and
   *  itemized-vs-standard — all of which the legacy proxy ignored. */
  computeIncomeTaxBaseWithRothTaxable?: (rothTaxable: number) => number;
  /** Legacy fallback — only consulted when `computeIncomeTaxBaseWithRothTaxable`
   *  is not provided. Pre-conversion ordinary-income tax base for this year. */
  preConversionOrdinaryIncome?: number;
  filingStatus?: FilingStatus;
  /** Legacy fallback: standard or itemized deduction the household will use. */
  taxDeduction?: number;
}

export interface RothConversionsResult {
  taxableOrdinaryIncome: number;
  /** Always 0 — Roth conversions never trigger early-withdrawal penalty per
   *  IRC §72(t)(2)(G), but kept on the result for symmetry with TransfersResult. */
  earlyWithdrawalPenalty: number;
  /** Per-conversion gross + taxable. `gross` is what moved out of the source
   *  pool; `taxable` is the portion that lands in ordinary income (lower than
   *  gross when a Trad-IRA source has after-tax basis — Form 8606 pro-rata).
   *  `bySource` tracks gross per source. */
  byConversion: Record<string, { gross: number; taxable: number; bySource: Record<string, number> }>;
}

// ============================================================================
// Main Function
// ============================================================================

export function applyRothConversions(input: RothConversionsInput): RothConversionsResult {
  const {
    conversions,
    accounts,
    accountBalances,
    basisMap,
    rothValueMap,
    accountLedgers,
    year,
    ownerAges,
    spouseFamilyMemberId,
  } = input;

  const result: RothConversionsResult = {
    taxableOrdinaryIncome: 0,
    earlyWithdrawalPenalty: 0,
    byConversion: {},
  };

  if (!conversions || conversions.length === 0) return result;

  const accountMap = new Map<string, Account>(accounts.map((a) => [a.id, a]));

  for (const conv of conversions) {
    if (!_isActiveYear(conv, year)) continue;

    const destAccount = accountMap.get(conv.destinationAccountId);
    if (!destAccount) continue;

    // Resolve sources → only include source accounts that exist and have balance.
    const sources = conv.sourceAccountIds
      .map((id) => accountMap.get(id))
      .filter((a): a is Account => a != null && (accountBalances[a.id] ?? 0) > 0);
    if (sources.length === 0) continue;

    const sourcePoolBalance = sources.reduce(
      (sum, a) => sum + (accountBalances[a.id] ?? 0),
      0,
    );

    const targetAmount = _resolveTargetAmount(conv, year, sourcePoolBalance, input);
    if (targetAmount <= 0) continue;

    const cappedAmount = Math.min(targetAmount, sourcePoolBalance);

    // Distribute the conversion across sources in source-list order, draining
    // each before moving to the next. This matches the visible "Accounts to
    // Convert" list and gives advisors deterministic control.
    let remaining = cappedAmount;
    let taxablePerConversion = 0;
    const bySource: Record<string, number> = {};

    // Pre-compute the trad-IRA pool BEFORE this conversion slices it (the
    // pro-rata calc inside classifyTransferTax aggregates all Trad IRAs).
    const { allTraditionalIraBalance: poolBalAtStart, allTraditionalIraBasis: poolBasisAtStart } =
      _computeTradIraPool(accounts, accountBalances, basisMap);
    let workingPoolBalance = poolBalAtStart;
    let workingPoolBasis = poolBasisAtStart;

    for (const src of sources) {
      if (remaining <= 0) break;
      const srcBalance = accountBalances[src.id] ?? 0;
      if (srcBalance <= 0) continue;

      const slice = Math.min(remaining, srcBalance);

      const isSpouseOwned =
        spouseFamilyMemberId != null &&
        controllingFamilyMember(src) === spouseFamilyMemberId;
      const ownerAge = isSpouseOwned && ownerAges.spouse != null ? ownerAges.spouse : ownerAges.client;

      const taxResult = classifyTransferTax({
        sourceCategory: src.category,
        sourceSubType: src.subType,
        targetCategory: destAccount.category,
        targetSubType: destAccount.subType,
        amount: slice,
        sourceAccountValue: srcBalance,
        sourceAccountBasis: basisMap[src.id] ?? 0,
        sourceRothValue: rothValueMap?.[src.id] ?? 0,
        allTraditionalIraBasis: workingPoolBasis,
        allTraditionalIraBalance: workingPoolBalance,
        ownerAge,
        rothBasis: basisMap[src.id] ?? 0,
      });

      // Update balances
      accountBalances[src.id] = srcBalance - slice;
      accountBalances[destAccount.id] = (accountBalances[destAccount.id] ?? 0) + slice;

      // Move proportional basis
      _updateBasis(src.id, destAccount.id, slice, srcBalance, basisMap);

      // Move proportional rothValue out of 401k/403b sources. The Roth slice
      // transferred — plus the (now-taxed) pre-tax slice — both land as Roth
      // basis on a Roth IRA destination, so the destination's basis bumps by
      // the full slice amount.
      _updateRothValueAndDestBasis(
        src.id,
        destAccount.id,
        destAccount.subType,
        slice,
        srcBalance,
        rothValueMap,
        basisMap,
      );

      // Update ledgers
      _updateLedgers(conv, src.id, destAccount.id, slice, accountLedgers);

      // After _updateBasis ran, the Trad-IRA aggregation pool shrank.
      // Refresh it so the next slice's pro-rata math is accurate.
      const refreshed = _computeTradIraPool(accounts, accountBalances, basisMap);
      workingPoolBalance = refreshed.allTraditionalIraBalance;
      workingPoolBasis = refreshed.allTraditionalIraBasis;

      result.taxableOrdinaryIncome += taxResult.taxableOrdinaryIncome;
      taxablePerConversion += taxResult.taxableOrdinaryIncome;
      bySource[src.id] = slice;
      remaining -= slice;
    }

    result.byConversion[conv.id] = {
      gross: cappedAmount - Math.max(0, remaining),
      taxable: taxablePerConversion,
      bySource,
    };
  }

  return result;
}

// ============================================================================
// Private Helpers
// ============================================================================

function _isActiveYear(conv: RothConversion, year: number): boolean {
  if (year < conv.startYear) return false;
  if (conv.endYear != null && year > conv.endYear) return false;
  return true;
}

/**
 * Resolves the desired conversion amount for the year before capping at the
 * available source pool. Returns 0 when the conversion cannot run this year.
 */
function _resolveTargetAmount(
  conv: RothConversion,
  year: number,
  sourcePoolBalance: number,
  input: RothConversionsInput,
): number {
  switch (conv.conversionType) {
    case "fixed_amount": {
      const inflateFrom = conv.inflationStartYear ?? conv.startYear;
      const yearsElapsed = Math.max(0, year - inflateFrom);
      const indexed = conv.fixedAmount * Math.pow(1 + (conv.indexingRate ?? 0), yearsElapsed);
      return indexed;
    }

    case "full_account": {
      // Convert the entire source pool, but only in the start year — repeating
      // every year inside the window would do nothing after year 1 (sources
      // are drained), and would surprise the advisor.
      if (year !== conv.startYear) return 0;
      return sourcePoolBalance;
    }

    case "deplete_over_period": {
      if (conv.endYear == null) return 0;
      const yearsRemaining = conv.endYear - year + 1;
      if (yearsRemaining <= 0) return 0;
      return sourcePoolBalance / yearsRemaining;
    }

    case "fill_up_bracket": {
      const {
        ordinaryBrackets,
        computeIncomeTaxBaseWithRothTaxable,
        preConversionOrdinaryIncome,
        taxDeduction,
      } = input;
      if (ordinaryBrackets == null || conv.fillUpBracket == null) return 0;
      const tier = ordinaryBrackets.find(
        (t) => Math.abs(t.rate - conv.fillUpBracket!) < 1e-9,
      );
      if (!tier || tier.to == null) return 0;

      // Preferred path: caller supplied a `computeIncomeTaxBaseWithRothTaxable`
      // closure that returns the year's true `incomeTaxBase` for any hypothetical
      // Roth-conversion taxable amount. Iterate to converge `incomeTaxBase ≈ tier.to`.
      //
      // Two-pass with bounded fixed-point iteration handles non-linearities like:
      //   - SS taxability phase-in (50%/85% thresholds bend the curve)
      //   - QBI deduction phase-in
      //   - any other piecewise-linear deduction that depends on AGI
      //
      // For trad IRAs with after-tax basis the gross conversion will be larger
      // than the taxable amount we solve for; the per-slice loop in the main
      // function caps the gross to source-pool balance, which is the right
      // behavior (we never want to over-convert). The taxable result will be
      // a bit shy of tier.to in basis-heavy cases — acceptable.
      if (computeIncomeTaxBaseWithRothTaxable) {
        const baseAt0 = computeIncomeTaxBaseWithRothTaxable(0);
        if (baseAt0 >= tier.to) return 0;
        let target = tier.to - baseAt0; // initial guess assumes linear
        for (let i = 0; i < 6; i++) {
          const baseAtTarget = computeIncomeTaxBaseWithRothTaxable(target);
          const delta = tier.to - baseAtTarget;
          if (Math.abs(delta) < 1) break;
          // Conservative update: never let target go negative; if SS or other
          // stack-up made the previous guess overshoot, pull it back.
          target = Math.max(0, target + delta);
        }
        return Math.max(0, target);
      }

      // Legacy fallback (kept for callers that haven't migrated). Known issues:
      // ignores taxable-SS, above-line deductions, QBI, and itemized > std.
      if (preConversionOrdinaryIncome == null) return 0;
      const taxableBeforeConv = Math.max(
        0,
        preConversionOrdinaryIncome - (taxDeduction ?? 0),
      );
      return Math.max(0, tier.to - taxableBeforeConv);
    }

    default:
      return 0;
  }
}

function _computeTradIraPool(
  accounts: Account[],
  accountBalances: Record<string, number>,
  basisMap: Record<string, number>,
): { allTraditionalIraBalance: number; allTraditionalIraBasis: number } {
  const TRAD_IRA_SUBTYPES = new Set(["traditional_ira", "sep_ira", "simple_ira"]);
  let allTraditionalIraBalance = 0;
  let allTraditionalIraBasis = 0;
  for (const account of accounts) {
    if (account.category === "retirement" && TRAD_IRA_SUBTYPES.has(account.subType)) {
      allTraditionalIraBalance += accountBalances[account.id] ?? 0;
      allTraditionalIraBasis += basisMap[account.id] ?? 0;
    }
  }
  return { allTraditionalIraBalance, allTraditionalIraBasis };
}

function _updateBasis(
  sourceId: string,
  targetId: string,
  amount: number,
  sourceBalanceBefore: number,
  basisMap: Record<string, number>,
): void {
  const sourceBasis = basisMap[sourceId] ?? 0;
  if (sourceBasis <= 0 || sourceBalanceBefore <= 0) return;
  const fractionMoved = amount / sourceBalanceBefore;
  const basisMoved = sourceBasis * fractionMoved;
  basisMap[sourceId] = sourceBasis - basisMoved;
  basisMap[targetId] = (basisMap[targetId] ?? 0) + basisMoved;
}

function _updateRothValueAndDestBasis(
  sourceId: string,
  targetId: string,
  targetSubType: string,
  amount: number,
  sourceBalanceBefore: number,
  rothValueMap: Record<string, number> | undefined,
  basisMap: Record<string, number>,
): void {
  if (!rothValueMap || sourceBalanceBefore <= 0) return;
  const sourceRoth = rothValueMap[sourceId] ?? 0;
  const fractionMoved = amount / sourceBalanceBefore;
  const rothMoved = sourceRoth * fractionMoved;
  if (sourceRoth > 0) {
    rothValueMap[sourceId] = Math.max(0, sourceRoth - rothMoved);
  }
  // Roth IRA destination: the entire converted amount becomes already-taxed
  // basis (pre-tax slice was just taxed at conversion; Roth slice was already
  // after-tax). Roth IRA tracks this via basisMap.
  if (targetSubType === "roth_ira") {
    basisMap[targetId] = (basisMap[targetId] ?? 0) + amount;
    return;
  }
  // 401k / 403b destination: just the Roth slice carries over as rothValue.
  if (targetSubType === "401k" || targetSubType === "403b") {
    rothValueMap[targetId] = (rothValueMap[targetId] ?? 0) + rothMoved;
  }
}

function _updateLedgers(
  conv: RothConversion,
  sourceId: string,
  targetId: string,
  amount: number,
  accountLedgers: Record<string, AccountLedger>,
): void {
  const sourceLedger = accountLedgers[sourceId];
  if (sourceLedger) {
    sourceLedger.distributions += amount;
    sourceLedger.endingValue -= amount;
    sourceLedger.entries.push({
      category: "withdrawal",
      label: conv.name,
      amount: -amount,
      sourceId: conv.id,
    });
  }
  const targetLedger = accountLedgers[targetId];
  if (targetLedger) {
    targetLedger.contributions += amount;
    targetLedger.endingValue += amount;
    targetLedger.entries.push({
      category: "savings_contribution",
      label: conv.name,
      amount,
      sourceId: conv.id,
    });
  }
}
