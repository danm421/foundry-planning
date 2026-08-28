import { splitAnnuityDistribution } from "./annuity/tax";

export interface TransferTaxInput {
  sourceCategory: "taxable" | "cash" | "retirement" | "annuity" | "real_estate" | "business" | "life_insurance" | "notes_receivable" | "stock_options" | "education_savings";
  sourceSubType: string;
  targetCategory: "taxable" | "cash" | "retirement" | "annuity" | "real_estate" | "business" | "life_insurance" | "notes_receivable" | "stock_options" | "education_savings";
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
  /** Unspent portion of this year's basisIncrease on the source account
   *  (taxable/cash sources only). 0/undefined preserves today's pro-rata
   *  behavior. */
  sourceFreshBasis?: number;
  /** Annuity source only: the contract's tax treatment. Defaults to
   *  non_qualified when the caller doesn't know. */
  sourceAnnuityTreatment?: "qualified" | "non_qualified" | "tax_free";
  /** Annuity source only: unrecovered §72 basis. Undefined ⇒ basis equals the
   *  account value, so no phantom gain appears. */
  sourceAnnuityBasis?: number;
}

export interface TransferTaxResult {
  taxableOrdinaryIncome: number;
  capitalGain: number;
  /** Portion of `amount` that came out of basis (no tax). For taxable/cash
   *  source liquidations only; 0 for retirement-source transfers. */
  basisReturn: number;
  earlyWithdrawalPenalty: number;
  label: "tax_free_rollover" | "roth_conversion" | "taxable_distribution" | "early_distribution" | "taxable_liquidation" | "qualified_hsa_distribution";
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

  // HSA source: any transfer out is a qualified (medical) distribution —
  // tax-free, no penalty, at any age, regardless of target. The pre-65 lock
  // applies only to the engine's deficit-driven liquidation, not to explicit
  // advisor transfers. Must precede all category branches below.
  if (sourceCategory === "retirement" && sourceSubType === "hsa") {
    return {
      taxableOrdinaryIncome: 0,
      capitalGain: 0,
      basisReturn: amount,
      earlyWithdrawalPenalty: 0,
      label: "qualified_hsa_distribution",
    };
  }

  // ── Annuity source ───────────────────────────────────────────────────────
  // IRC §72, same rules as categorizeDraw. Gain-first (LIFO), ordinary income
  // never capital gain, and the penalty falls on the taxable slice only. The
  // treatment travels on the ACCOUNT (`sourceAnnuityTreatment`), not on
  // `sourceSubType` — an annuity's subType carries the product, not the tax
  // wrapper.
  if (sourceCategory === "annuity") {
    const treatment = input.sourceAnnuityTreatment ?? "non_qualified";

    // A qualified annuity is pre-tax RETIREMENT money in an insurance wrapper,
    // so a move into another retirement account is a §408 rollover, not a §72
    // distribution — decided BEFORE the §72 split below. Mirror the
    // retirement→retirement house rule rather than contradicting it: tax-free
    // unless the target is a Roth, which makes it a conversion — taxable, but
    // never penalized. Without this the branch fabricates a five-figure tax
    // bill on a six-figure IRA rollover. (Deliberately NOT extended to annuity
    // → annuity: §1035 exchange modeling is out of scope for this feature.)
    if (treatment === "qualified" && targetCategory === "retirement") {
      if (ROTH_SUBTYPES.has(targetSubType)) {
        return { taxableOrdinaryIncome: amount, capitalGain: 0, basisReturn: 0,
                 earlyWithdrawalPenalty: 0, label: "roth_conversion" };
      }
      return { taxableOrdinaryIncome: 0, capitalGain: 0, basisReturn: 0,
               earlyWithdrawalPenalty: 0, label: "tax_free_rollover" };
    }

    // IRC §72 proper, shared with `categorizeDraw` — see
    // `splitAnnuityDistribution`.
    const split = splitAnnuityDistribution({
      treatment,
      amount,
      accountValue: sourceAccountValue,
      remainingBasis: input.sourceAnnuityBasis,
      ownerAge,
    });
    return {
      taxableOrdinaryIncome: split.ordinaryIncome,
      capitalGain: 0,
      basisReturn: split.basisReturn,
      earlyWithdrawalPenalty: split.earlyWithdrawalPenalty,
      label:
        treatment === "tax_free"
          ? "tax_free_rollover"
          : split.earlyWithdrawalPenalty > 0
            ? "early_distribution"
            : "taxable_distribution",
    };
  }

  // ── Retirement → Retirement ──────────────────────────────────────────────
  if (sourceCategory === "retirement" && targetCategory === "retirement") {
    const sourceIsRoth = ROTH_SUBTYPES.has(sourceSubType);
    const targetIsRoth = ROTH_SUBTYPES.has(targetSubType);
    const sourceIsTaxDeferred = TAX_DEFERRED_SUBTYPES.has(sourceSubType);
    const sourceIs401kOr403b = sourceSubType === "401k" || sourceSubType === "403b";

    // Roth → Roth: no tax event
    if (sourceIsRoth && targetIsRoth) {
      return { taxableOrdinaryIncome: 0, capitalGain: 0, basisReturn: 0, earlyWithdrawalPenalty: 0, label: "tax_free_rollover" };
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
        return { taxableOrdinaryIncome, capitalGain: 0, basisReturn: 0, earlyWithdrawalPenalty: 0, label: "roth_conversion" };
      }
      const taxableOrdinaryIncome = _calcTaxDeferredToRothIncome(amount, allTraditionalIraBasis, allTraditionalIraBalance);
      return { taxableOrdinaryIncome, capitalGain: 0, basisReturn: 0, earlyWithdrawalPenalty: 0, label: "roth_conversion" };
    }

    // All other retirement → retirement: tax-free rollover
    return { taxableOrdinaryIncome: 0, capitalGain: 0, basisReturn: 0, earlyWithdrawalPenalty: 0, label: "tax_free_rollover" };
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
    return { taxableOrdinaryIncome, capitalGain: 0, basisReturn: 0, earlyWithdrawalPenalty, label };
  }

  // ── Taxable / Cash / Other → Any (high-basis-first ordering) ─────────────
  const { capitalGain, basisReturn } = _calcLotOrderedRealization(
    amount, sourceAccountValue, sourceAccountBasis, input.sourceFreshBasis ?? 0,
  );
  return { taxableOrdinaryIncome: 0, capitalGain, basisReturn, earlyWithdrawalPenalty: 0, label: "taxable_liquidation" };
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
      basisReturn: 0,
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
  return { taxableOrdinaryIncome, capitalGain: 0, basisReturn: 0, earlyWithdrawalPenalty, label };
}

/**
 * Classifies a Roth distribution using ordering rules:
 * contributions (basis) come out first, tax-free and penalty-free;
 * earnings above basis are taxable and penalized only pre-59.5 — a
 * qualified (59.5+) distribution is entirely tax-free (mirrors
 * categorizeDraw's Roth branch).
 */
function _classifyRothDistribution(
  amount: number,
  rothBasis: number,
  isEarly: boolean,
): TransferTaxResult {
  // Contributions come out first — no tax, no penalty
  const taxFreeAmount = Math.min(amount, rothBasis);
  const earningsWithdrawn = Math.max(0, amount - taxFreeAmount);

  const taxableOrdinaryIncome = isEarly ? earningsWithdrawn : 0;
  const earlyWithdrawalPenalty = isEarly ? earningsWithdrawn * EARLY_WITHDRAWAL_PENALTY_RATE : 0;
  const label = isEarly && earningsWithdrawn > 0 ? "early_distribution" : "taxable_distribution";

  return { taxableOrdinaryIncome, capitalGain: 0, basisReturn: 0, earlyWithdrawalPenalty, label };
}

/**
 * High-basis-first realization on a taxable-source liquidation.
 * See spec 2026-05-11-fresh-basis-withdrawal-ordering-design.
 *
 * - Up to `sourceFreshBasis` dollars come out 100% basis (0 gain).
 * - The remainder is gained pro-rata against the *legacy* pool:
 *     legacyValue = sourceAccountValue − sourceFreshBasis
 *     legacyBasis = sourceAccountBasis − sourceFreshBasis
 *     gainRatio   = min(1, 1 − legacyBasis / legacyValue)   // signed; may be negative
 */
function _calcLotOrderedRealization(
  amount: number,
  sourceAccountValue: number,
  sourceAccountBasis: number,
  sourceFreshBasis: number,
): { capitalGain: number; basisReturn: number } {
  if (sourceAccountValue <= 0) return { capitalGain: amount, basisReturn: 0 };
  const fresh = Math.max(0, sourceFreshBasis);
  const freshDraw = Math.min(amount, fresh);
  const legacyDraw = amount - freshDraw;
  const legacyValue = sourceAccountValue - fresh;
  const legacyBasis = sourceAccountBasis - fresh;
  // Signed — mirrors categorizeDraw. Below 0 = underwater lot, realizing loss.
  let gainRatio = 0;
  if (legacyValue > 0) {
    gainRatio = Math.min(1, 1 - legacyBasis / legacyValue);
  }
  // Guard the multiply — mirrors categorizeDraw: a signed ratio times a zero
  // legacy draw would otherwise hand back -0.
  const capitalGain = legacyDraw === 0 ? 0 : legacyDraw * gainRatio;
  const basisReturn = freshDraw + legacyDraw * (1 - gainRatio);
  return { capitalGain, basisReturn };
}
