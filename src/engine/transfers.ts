import type { Account, Transfer, AccountLedger } from "./types";
import { classifyTransferTax } from "./tax-classification";

// ============================================================================
// Public Types
// ============================================================================

export interface TransfersInput {
  transfers: Transfer[];
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  accountLedgers: Record<string, AccountLedger>;
  year: number;
  ownerAges: { client: number; spouse?: number };
}

export interface TransfersResult {
  taxableOrdinaryIncome: number;
  capitalGains: number;
  earlyWithdrawalPenalty: number;
  byTransfer: Record<string, { amount: number; label: string }>;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Applies all transfers active in the given year.
 *
 * For each transfer:
 *   1. Determines the transfer amount for the year based on mode.
 *   2. Caps at the source account balance.
 *   3. Classifies the tax treatment via classifyTransferTax().
 *   4. Updates accountBalances, basisMap, and accountLedgers.
 *   5. Accumulates and returns aggregate tax results.
 *
 * Transfers occur after annual growth has been applied but before RMDs.
 */
export function applyTransfers(input: TransfersInput): TransfersResult {
  const { transfers, accounts, accountBalances, basisMap, accountLedgers, year, ownerAges } = input;

  const result: TransfersResult = {
    taxableOrdinaryIncome: 0,
    capitalGains: 0,
    earlyWithdrawalPenalty: 0,
    byTransfer: {},
  };

  // Build a fast account lookup map
  const accountMap = new Map<string, Account>(accounts.map((a) => [a.id, a]));

  // Pre-compute total traditional IRA / 401k balance and basis across all
  // accounts for the pro-rata rule used in Roth conversions.
  const { allTraditionalIraBalance, allTraditionalIraBasis } = _computeTradIraPool(accounts, accountBalances, basisMap);

  for (const transfer of transfers) {
    const amount = _resolveAmount(transfer, year);
    if (amount === null || amount <= 0) continue;

    const sourceAccount = accountMap.get(transfer.sourceAccountId);
    const targetAccount = accountMap.get(transfer.targetAccountId);
    if (!sourceAccount || !targetAccount) continue;

    const sourceBalance = accountBalances[transfer.sourceAccountId] ?? 0;
    if (sourceBalance <= 0) continue;

    // Cap at available balance
    const actualAmount = Math.min(amount, sourceBalance);

    // Determine owner age for penalty calculation
    const ownerAge = _resolveOwnerAge(sourceAccount.owner, ownerAges);

    // Classify tax treatment
    const taxResult = classifyTransferTax({
      sourceCategory: sourceAccount.category,
      sourceSubType: sourceAccount.subType,
      targetCategory: targetAccount.category,
      targetSubType: targetAccount.subType,
      amount: actualAmount,
      sourceAccountValue: sourceBalance,
      sourceAccountBasis: basisMap[transfer.sourceAccountId] ?? 0,
      allTraditionalIraBasis,
      allTraditionalIraBalance,
      ownerAge,
      rothBasis: basisMap[transfer.targetAccountId] ?? 0,
    });

    // ── Update balances ──────────────────────────────────────────────────────
    accountBalances[transfer.sourceAccountId] = sourceBalance - actualAmount;
    accountBalances[transfer.targetAccountId] = (accountBalances[transfer.targetAccountId] ?? 0) + actualAmount;

    // ── Update basis map (proportional basis moves with the transfer) ────────
    _updateBasis(transfer.sourceAccountId, transfer.targetAccountId, actualAmount, sourceBalance, basisMap);

    // ── Update ledgers ───────────────────────────────────────────────────────
    _updateLedgers(transfer, actualAmount, taxResult.label, accountLedgers);

    // ── Accumulate tax results ───────────────────────────────────────────────
    result.taxableOrdinaryIncome += taxResult.taxableOrdinaryIncome;
    result.capitalGains += taxResult.capitalGain;
    result.earlyWithdrawalPenalty += taxResult.earlyWithdrawalPenalty;
    result.byTransfer[transfer.id] = { amount: actualAmount, label: taxResult.label };
  }

  return result;
}

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Resolves the transfer amount for a given year based on the transfer mode.
 * Returns null when the transfer is not active this year.
 */
function _resolveAmount(transfer: Transfer, year: number): number | null {
  switch (transfer.mode) {
    case "one_time": {
      if (year !== transfer.startYear) return null;
      return transfer.amount;
    }

    case "recurring": {
      if (year < transfer.startYear) return null;
      if (transfer.endYear != null && year > transfer.endYear) return null;
      const yearsElapsed = year - transfer.startYear;
      return transfer.amount * Math.pow(1 + transfer.growthRate, yearsElapsed);
    }

    case "scheduled": {
      const schedule = transfer.schedules.find((s) => s.year === year);
      if (!schedule) return null;
      return schedule.amount;
    }

    default:
      return null;
  }
}

/**
 * Computes the aggregate balance and after-tax basis across all Traditional
 * IRAs for the Form 8606 pro-rata rule.
 *
 * IRS Form 8606 aggregates ONLY Traditional IRAs (including SEP and SIMPLE
 * IRAs); 401(k) basis is tracked per-plan and NEVER rolls into the IRA
 * aggregation pool. Folding 401(k) in here overstated the non-taxable
 * fraction of a Trad-IRA → Roth conversion whenever the client had any
 * after-tax 401(k) basis, under-reporting conversion income.
 */
function _computeTradIraPool(
  accounts: Account[],
  accountBalances: Record<string, number>,
  basisMap: Record<string, number>,
): { allTraditionalIraBalance: number; allTraditionalIraBasis: number } {
  // Form 8606 aggregation pool: Trad IRAs only. 401(k) basis stays on the plan.
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

/**
 * Resolves the owner's age from ownerAges based on account ownership.
 * Falls back to client age for joint accounts.
 */
function _resolveOwnerAge(
  owner: "client" | "spouse" | "joint",
  ownerAges: { client: number; spouse?: number },
): number {
  if (owner === "spouse" && ownerAges.spouse != null) return ownerAges.spouse;
  return ownerAges.client;
}

/**
 * Moves proportional basis from source to target when a transfer occurs.
 *
 * The fraction of basis moved equals the fraction of the account balance
 * being transferred.
 */
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

/**
 * Records ledger entries for both source (withdrawal) and target
 * (savings_contribution) accounts.
 */
function _updateLedgers(
  transfer: Transfer,
  amount: number,
  label: string,
  accountLedgers: Record<string, AccountLedger>,
): void {
  const sourceLedger = accountLedgers[transfer.sourceAccountId];
  if (sourceLedger) {
    sourceLedger.distributions += amount;
    sourceLedger.endingValue -= amount;
    sourceLedger.entries.push({
      category: "withdrawal",
      label: transfer.name,
      amount: -amount,
      sourceId: transfer.id,
    });
  }

  const targetLedger = accountLedgers[transfer.targetAccountId];
  if (targetLedger) {
    targetLedger.contributions += amount;
    targetLedger.endingValue += amount;
    targetLedger.entries.push({
      category: "savings_contribution",
      label: transfer.name,
      amount,
      sourceId: transfer.id,
    });
  }
}
