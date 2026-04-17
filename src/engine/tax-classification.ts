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
}

export interface TransferTaxResult {
  taxableOrdinaryIncome: number;
  capitalGain: number;
  earlyWithdrawalPenalty: number;
  label: "tax_free_rollover" | "roth_conversion" | "taxable_distribution" | "early_distribution" | "taxable_liquidation";
}

const TAX_DEFERRED_SUBTYPES = new Set(["traditional_ira", "401k"]);
const ROTH_SUBTYPES = new Set(["roth_ira", "roth_401k"]);
const RETIREMENT_SUBTYPES = new Set(["traditional_ira", "401k", "roth_ira", "roth_401k", "529"]);

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
  } = input;

  // ── Retirement → Retirement ──────────────────────────────────────────────
  if (sourceCategory === "retirement" && targetCategory === "retirement") {
    const sourceIsRoth = ROTH_SUBTYPES.has(sourceSubType);
    const targetIsRoth = ROTH_SUBTYPES.has(targetSubType);
    const sourceIsTaxDeferred = TAX_DEFERRED_SUBTYPES.has(sourceSubType);

    // Roth → Roth: no tax event
    if (sourceIsRoth && targetIsRoth) {
      return { taxableOrdinaryIncome: 0, capitalGain: 0, earlyWithdrawalPenalty: 0, label: "tax_free_rollover" };
    }

    // Tax-deferred → Roth: Roth conversion (taxable, no penalty)
    if (sourceIsTaxDeferred && targetIsRoth) {
      const taxableOrdinaryIncome = _calcTaxDeferredToRothIncome(amount, allTraditionalIraBasis, allTraditionalIraBalance);
      return { taxableOrdinaryIncome, capitalGain: 0, earlyWithdrawalPenalty: 0, label: "roth_conversion" };
    }

    // All other retirement → retirement: tax-free rollover
    return { taxableOrdinaryIncome: 0, capitalGain: 0, earlyWithdrawalPenalty: 0, label: "tax_free_rollover" };
  }

  // ── Retirement → Non-Retirement (distribution) ───────────────────────────
  if (sourceCategory === "retirement") {
    const sourceIsRoth = ROTH_SUBTYPES.has(sourceSubType);
    const isEarly = ownerAge < EARLY_WITHDRAWAL_AGE;

    if (sourceIsRoth) {
      return _classifyRothDistribution(amount, rothBasis, isEarly);
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
