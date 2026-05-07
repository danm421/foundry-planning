export interface TransferTaxInput {
  sourceCategory: "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";
  sourceSubType: string;
  targetCategory: "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";
  targetSubType: string;
  amount: number;
  sourceAccountValue: number;
  sourceAccountBasis: number;
  allTraditionalIraBasis: number;
  allTraditionalIraBalance: number;
  ownerAge: number;
  rothBasis: number;
  /**
   * For 401k/403b sources: the Roth-designated portion of the source balance.
   * The pro-rata Roth slice on a withdrawal or Roth conversion is excluded
   * from ordinary income (and from the conversion's taxable amount). 0 for
   * non-401k/403b sources.
   */
  sourceRothValue?: number;
}

export interface TransferTaxResult {
  taxableOrdinaryIncome: number;
  capitalGain: number;
  earlyWithdrawalPenalty: number;
  label: "tax_free_rollover" | "roth_conversion" | "taxable_distribution" | "early_distribution" | "taxable_liquidation";
}

// 401k/403b are mixed accounts: pre-tax by default, Roth via the per-account
// rothValue field. The dedicated roth_401k / roth_403b subtypes were removed.
const TAX_DEFERRED_SUBTYPES = new Set(["traditional_ira", "401k", "403b"]);
const ROTH_SUBTYPES = new Set(["roth_ira"]);

const EARLY_WITHDRAWAL_AGE = 59.5;
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10;

/**
 * Classifies the tax treatment of a transfer between two accounts.
 *
 * Returns the taxable ordinary income, capital gain, and early withdrawal
 * penalty that result from the transfer, along with a descriptive label.
 */
export function classifyTransferTax(input: TransferTaxInput): TransferTaxResult {
  const {
    sourceCategory,
    sourceSubType,
    targetCategory,
    targetSubType,
    amount,
    sourceAccountValue,
    sourceAccountBasis,
    allTraditionalIraBasis,
    allTraditionalIraBalance,
    ownerAge,
    rothBasis,
    sourceRothValue = 0,
  } = input;

  // ── Retirement → Retirement ──────────────────────────────────────────────
  if (sourceCategory === "retirement" && targetCategory === "retirement") {
    const sourceIsRoth = ROTH_SUBTYPES.has(sourceSubType);
    const targetIsRoth = ROTH_SUBTYPES.has(targetSubType);
    const sourceIsTaxDeferred = TAX_DEFERRED_SUBTYPES.has(sourceSubType);
    const sourceIs401kOr403b = sourceSubType === "401k" || sourceSubType === "403b";

    // Roth → Roth: no tax event
    if (sourceIsRoth && targetIsRoth) {
      return { taxableOrdinaryIncome: 0, capitalGain: 0, earlyWithdrawalPenalty: 0, label: "tax_free_rollover" };
    }

    // Tax-deferred → Roth: Roth conversion (taxable, no penalty).
    //   - Traditional IRA source → Form 8606 pro-rata across the aggregated
    //     Trad-IRA pool (allTraditionalIraBalance / allTraditionalIraBasis).
    //   - 401(k) / 403(b) source → the source's `rothValue` slice transfers
    //     tax-free; the rest of the converted amount is fully taxable OI.
    //     The legacy per-plan basis path was removed — those subtypes use
    //     rothValue exclusively to track already-taxed dollars.
    if (sourceIsTaxDeferred && targetIsRoth) {
      if (sourceIs401kOr403b) {
        const taxableOrdinaryIncome = _calc401kToRothIncome(amount, sourceAccountValue, sourceRothValue);
        return { taxableOrdinaryIncome, capitalGain: 0, earlyWithdrawalPenalty: 0, label: "roth_conversion" };
      }
      const taxableOrdinaryIncome = _calcTaxDeferredToRothIncome(amount, allTraditionalIraBasis, allTraditionalIraBalance);
      return { taxableOrdinaryIncome, capitalGain: 0, earlyWithdrawalPenalty: 0, label: "roth_conversion" };
    }

    // All other retirement → retirement: tax-free rollover
    return { taxableOrdinaryIncome: 0, capitalGain: 0, earlyWithdrawalPenalty: 0, label: "tax_free_rollover" };
  }

  // ── Retirement → Non-Retirement (distribution) ───────────────────────────
  if (sourceCategory === "retirement") {
    const sourceIsRoth = ROTH_SUBTYPES.has(sourceSubType);
    const sourceIs401kOr403b = sourceSubType === "401k" || sourceSubType === "403b";
    const isEarly = ownerAge < EARLY_WITHDRAWAL_AGE;

    if (sourceIsRoth) {
      return _classifyRothDistribution(amount, rothBasis, isEarly);
    }

    if (sourceIs401kOr403b) {
      return _classify401kDistribution(amount, sourceAccountValue, sourceRothValue, isEarly);
    }

    // Tax-deferred distribution: fully taxable as OI
    const taxableOrdinaryIncome = amount;
    const earlyWithdrawalPenalty = isEarly ? amount * EARLY_WITHDRAWAL_PENALTY_RATE : 0;
    const label = isEarly ? "early_distribution" : "taxable_distribution";
    return { taxableOrdinaryIncome, capitalGain: 0, earlyWithdrawalPenalty, label };
  }

  // ── Taxable / Cash / Other → Any (proportional capital gains) ────────────
  const capitalGain = _calcProportionalGain(amount, sourceAccountValue, sourceAccountBasis);
  return { taxableOrdinaryIncome: 0, capitalGain, earlyWithdrawalPenalty: 0, label: "taxable_liquidation" };
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Applies the pro-rata rule for a tax-deferred → Roth conversion.
 *
 * When the traditional IRA pool has after-tax basis, conversions are taxed
 * proportionally: only the pre-tax fraction of the converted amount is OI.
 */
function _calcTaxDeferredToRothIncome(
  amount: number,
  allTraditionalIraBasis: number,
  allTraditionalIraBalance: number,
): number {
  if (allTraditionalIraBalance <= 0) return amount;
  const basisFraction = allTraditionalIraBasis / allTraditionalIraBalance;
  const taxFreeFraction = basisFraction;
  return amount * (1 - taxFreeFraction);
}

/**
 * Pro-rata Roth slice for a 401(k) / 403(b) → Roth conversion.
 * The Roth-designated portion of the source transfers tax-free; the rest of
 * the converted amount is taxable as ordinary income.
 */
function _calc401kToRothIncome(
  amount: number,
  sourceAccountValue: number,
  sourceRothValue: number,
): number {
  if (sourceAccountValue <= 0) return amount;
  const rothFraction = Math.max(0, Math.min(1, sourceRothValue / sourceAccountValue));
  return amount * (1 - rothFraction);
}

/**
 * Pro-rata distribution from a 401(k) / 403(b). The Roth-designated slice
 * comes out tax-free (no penalty); the pre-tax slice is OI plus the early-
 * withdrawal penalty when pre-59.5.
 */
function _classify401kDistribution(
  amount: number,
  sourceAccountValue: number,
  sourceRothValue: number,
  isEarly: boolean,
): TransferTaxResult {
  if (sourceAccountValue <= 0) {
    const earlyPen = isEarly ? amount * EARLY_WITHDRAWAL_PENALTY_RATE : 0;
    return {
      taxableOrdinaryIncome: amount,
      capitalGain: 0,
      earlyWithdrawalPenalty: earlyPen,
      label: isEarly ? "early_distribution" : "taxable_distribution",
    };
  }
  const rothFraction = Math.max(0, Math.min(1, sourceRothValue / sourceAccountValue));
  const taxableOrdinaryIncome = amount * (1 - rothFraction);
  const earlyWithdrawalPenalty = isEarly
    ? taxableOrdinaryIncome * EARLY_WITHDRAWAL_PENALTY_RATE
    : 0;
  const label = isEarly && taxableOrdinaryIncome > 0 ? "early_distribution" : "taxable_distribution";
  return { taxableOrdinaryIncome, capitalGain: 0, earlyWithdrawalPenalty, label };
}

/**
 * Classifies a Roth distribution using ordering rules:
 * contributions (basis) come out first, tax-free and penalty-free;
 * earnings above basis are taxable and subject to early withdrawal penalty.
 */
function _classifyRothDistribution(
  amount: number,
  rothBasis: number,
  isEarly: boolean,
): TransferTaxResult {
  // Contributions come out first — no tax, no penalty
  const taxFreeAmount = Math.min(amount, rothBasis);
  const earningsWithdrawn = Math.max(0, amount - taxFreeAmount);

  const taxableOrdinaryIncome = earningsWithdrawn;
  const earlyWithdrawalPenalty = isEarly ? earningsWithdrawn * EARLY_WITHDRAWAL_PENALTY_RATE : 0;
  const label = isEarly && earningsWithdrawn > 0 ? "early_distribution" : "taxable_distribution";

  return { taxableOrdinaryIncome, capitalGain: 0, earlyWithdrawalPenalty, label };
}

/**
 * Calculates the proportional capital gain when liquidating a portion of an account.
 *
 * gainRatio = (accountValue - basis) / accountValue
 * capitalGain = amount * gainRatio
 */
function _calcProportionalGain(amount: number, accountValue: number, accountBasis: number): number {
  if (accountValue <= 0) return 0;
  const totalGain = accountValue - accountBasis;
  if (totalGain <= 0) return 0;
  const gainRatio = totalGain / accountValue;
  return amount * gainRatio;
}
