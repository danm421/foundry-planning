import type { Account, AccountLedger, AssetTransaction, Liability } from "./types";
import type { FilingStatus } from "../lib/tax/types";

/** IRC §121 home-sale exclusion caps by filing status.
 *  Married filing jointly gets $500k; all other statuses (single, head of
 *  household, married filing separately) get $250k. */
function homeSaleExclusionCap(filingStatus: FilingStatus): number {
  return filingStatus === "married_joint" ? 500_000 : 250_000;
}

// ── Synthetic ID counter ──────────────────────────────────────────────────────

let _syntheticIdCounter = 0;

export function _resetSyntheticIdCounter(): void {
  _syntheticIdCounter = 0;
}

/** Generate the next synthetic id for engine-created accounts or liabilities.
 *  Shared across asset-transactions (technique-created assets) and death-event
 *  (account splits) so ids remain unique within a projection run. */
export function nextSyntheticId(prefix: string): string {
  return `${prefix}-${++_syntheticIdCounter}`;
}

// ── applyAssetSales ───────────────────────────────────────────────────────────

export interface AssetSaleBreakdown {
  transactionId: string;
  accountId: string;
  saleValue: number;
  basis: number;
  transactionCosts: number;
  netProceeds: number;
  /** Raw capital gain (saleValue - basis, floored at 0), before the home-sale exclusion. */
  capitalGain: number;
  /** IRC §121 exclusion actually applied to this sale (0 unless the flag was set
   *  AND the account was real-estate AND there was gain to exclude). */
  homeSaleExclusionApplied: number;
  /** Gain that actually flows into taxable capital gains for the year. */
  taxableCapitalGain: number;
  mortgagePaidOff: number;
  proceedsAccountId: string;
}

export interface AssetSalesResult {
  /** Sum of taxable capital gains (already reduced by any home-sale exclusions applied). */
  capitalGains: number;
  /** Sum of §121 exclusions applied across all sales this year. */
  homeSaleExclusionTotal: number;
  removedAccountIds: string[];
  removedLiabilityIds: string[];
  breakdown: AssetSaleBreakdown[];
}

export interface ApplyAssetSalesInput {
  sales: AssetTransaction[];
  accounts: Account[];
  liabilities: Liability[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  accountLedgers: Record<string, AccountLedger>;
  year: number;
  defaultCheckingId: string;
  filingStatus: FilingStatus;
}

export function applyAssetSales(input: ApplyAssetSalesInput): AssetSalesResult {
  const {
    sales,
    accounts,
    liabilities,
    accountBalances,
    basisMap,
    accountLedgers,
    year,
    defaultCheckingId,
    filingStatus,
  } = input;

  let totalCapitalGains = 0;
  let homeSaleExclusionTotal = 0;
  const removedAccountIds: string[] = [];
  const removedLiabilityIds: string[] = [];
  const breakdown: AssetSaleBreakdown[] = [];

  for (const sale of sales) {
    if (sale.type !== "sell" || sale.year !== year) continue;
    if (!sale.accountId) continue;

    const accountId = sale.accountId;
    const currentBalance = accountBalances[accountId] ?? 0;
    const currentBasis = basisMap[accountId] ?? 0;

    // Determine sale value and basis (use overrides when provided)
    const saleValue = sale.overrideSaleValue ?? currentBalance;
    const basis = sale.overrideBasis ?? currentBasis;

    // Calculate transaction costs
    const costPct = (sale.transactionCostPct ?? 0) * saleValue;
    const costFlat = sale.transactionCostFlat ?? 0;
    const transactionCosts = costPct + costFlat;

    // Capital gain is on full sale value minus basis (not reduced by transaction costs)
    const capitalGain = Math.max(0, saleValue - basis);

    // IRC §121 home-sale exclusion. Applied only when the flag is set AND
    // the sold account's category is "real_estate" — the category gate is a
    // safety net against an errant true on a non-real-estate transaction.
    const soldAccount = accounts.find((a) => a.id === accountId);
    let homeSaleExclusionApplied = 0;
    if (
      sale.qualifiesForHomeSaleExclusion &&
      soldAccount?.category === "real_estate" &&
      capitalGain > 0
    ) {
      homeSaleExclusionApplied = Math.min(capitalGain, homeSaleExclusionCap(filingStatus));
      homeSaleExclusionTotal += homeSaleExclusionApplied;
    }
    const taxableCapitalGain = capitalGain - homeSaleExclusionApplied;
    totalCapitalGains += taxableCapitalGain;

    // Net proceeds after costs
    let netProceeds = saleValue - transactionCosts;

    // Pay off linked mortgage if this is a real estate / property sale
    let mortgagePaidOff = 0;
    const linkedMortgage = liabilities.find(
      (l) => l.linkedPropertyId === accountId
    );
    if (linkedMortgage) {
      const mortgageBalance = linkedMortgage.balance;
      netProceeds -= mortgageBalance;
      mortgagePaidOff = mortgageBalance;
      removedLiabilityIds.push(linkedMortgage.id);
    }

    // Zero out the sold account
    accountBalances[accountId] = 0;
    basisMap[accountId] = 0;
    removedAccountIds.push(accountId);

    // Update sold account ledger
    if (accountLedgers[accountId]) {
      accountLedgers[accountId].distributions -= saleValue;
      accountLedgers[accountId].endingValue = 0;
      accountLedgers[accountId].entries.push({
        category: "withdrawal",
        label: `Asset sale: ${sale.name}`,
        amount: -saleValue,
        sourceId: sale.id,
      });
    }

    // Route net proceeds to destination account
    const proceedsAccountId = sale.proceedsAccountId ?? defaultCheckingId;
    accountBalances[proceedsAccountId] = (accountBalances[proceedsAccountId] ?? 0) + netProceeds;
    basisMap[proceedsAccountId] = (basisMap[proceedsAccountId] ?? 0) + netProceeds;

    if (accountLedgers[proceedsAccountId]) {
      accountLedgers[proceedsAccountId].contributions += netProceeds;
      accountLedgers[proceedsAccountId].endingValue =
        accountLedgers[proceedsAccountId].endingValue + netProceeds;
      accountLedgers[proceedsAccountId].entries.push({
        category: "income",
        label: `Sale proceeds: ${sale.name}`,
        amount: netProceeds,
        sourceId: sale.id,
      });
    }

    breakdown.push({
      transactionId: sale.id,
      accountId,
      saleValue,
      basis,
      transactionCosts,
      netProceeds,
      capitalGain,
      homeSaleExclusionApplied,
      taxableCapitalGain,
      mortgagePaidOff,
      proceedsAccountId,
    });
  }

  return {
    capitalGains: totalCapitalGains,
    homeSaleExclusionTotal,
    removedAccountIds,
    removedLiabilityIds,
    breakdown,
  };
}

// ── applyAssetPurchases ───────────────────────────────────────────────────────

export interface AssetPurchaseBreakdown {
  transactionId: string;
  name: string;
  equity: number;
  purchasePrice: number;
  mortgageAmount: number;
  fundingAccountId: string;
  /** Synthetic liability id when this purchase created a new mortgage. */
  liabilityId?: string;
  /** Display name for the synthetic liability. */
  liabilityName?: string;
}

export interface AssetPurchasesResult {
  newAccounts: Account[];
  newLiabilities: Liability[];
  breakdown: AssetPurchaseBreakdown[];
}

export interface ApplyAssetPurchasesInput {
  purchases: AssetTransaction[];
  accounts: Account[];
  liabilities: Liability[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  accountLedgers: Record<string, AccountLedger>;
  year: number;
  defaultCheckingId: string;
}

function _calcMonthlyPayment(amount: number, rate: number, termMonths: number): number {
  const monthlyRate = rate / 12;
  const n = termMonths;
  return monthlyRate > 0
    ? (amount * monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
    : amount / n;
}

export function applyAssetPurchases(input: ApplyAssetPurchasesInput): AssetPurchasesResult {
  const {
    purchases,
    accountBalances,
    basisMap,
    accountLedgers,
    year,
    defaultCheckingId,
  } = input;

  const newAccounts: Account[] = [];
  const newLiabilities: Liability[] = [];
  const breakdown: AssetPurchaseBreakdown[] = [];

  for (const purchase of purchases) {
    if (purchase.type !== "buy" || purchase.year !== year) continue;

    const purchasePrice = purchase.purchasePrice ?? 0;
    const mortgageAmount = purchase.mortgageAmount ?? 0;
    const equity = purchasePrice - mortgageAmount;

    // Determine funding source
    const fundingAccountId = purchase.fundingAccountId ?? defaultCheckingId;

    // Breakdown is pushed at the end of this iteration so it can reference the
    // synthetic liability id/name when a mortgage is created below.
    let syntheticLiabilityId: string | undefined;
    let syntheticLiabilityName: string | undefined;

    // Debit equity from funding account. Balance drops dollar-for-dollar.
    // Basis, though, should reduce proportionally to the fraction of the
    // account being spent — a $100k purchase funded from a taxable account
    // worth $500k with $200k basis should pull down $40k of basis (20% of
    // the account), not the full $100k. Flat-debiting basis dollar-for-
    // dollar drives basis negative over repeated large withdrawals (and
    // distorts future capital-gain calcs for the funding account). Cash
    // accounts have basis == balance by construction, so either rule
    // produces the same number there.
    const fundingBalance = accountBalances[fundingAccountId] ?? 0;
    const fundingBasis = basisMap[fundingAccountId] ?? 0;
    const basisDebit =
      fundingBalance > 0
        ? Math.min(fundingBasis, fundingBasis * (equity / fundingBalance))
        : equity;
    accountBalances[fundingAccountId] = fundingBalance - equity;
    basisMap[fundingAccountId] = Math.max(0, fundingBasis - basisDebit);

    if (accountLedgers[fundingAccountId]) {
      accountLedgers[fundingAccountId].distributions -= equity;
      accountLedgers[fundingAccountId].endingValue =
        accountLedgers[fundingAccountId].endingValue - equity;
      accountLedgers[fundingAccountId].entries.push({
        category: "expense",
        label: `Asset purchase: ${purchase.name}`,
        amount: -equity,
        sourceId: purchase.id,
      });
    }

    // Create synthetic account
    const newAccountId = nextSyntheticId("technique-acct");
    const assetBasis = purchase.basis ?? purchasePrice;

    const newAccount: Account = {
      id: newAccountId,
      name: purchase.assetName ?? purchase.name,
      category: purchase.assetCategory ?? "taxable",
      subType: purchase.assetSubType ?? "other",
      owner: "client",
      value: purchasePrice,
      basis: assetBasis,
      growthRate: purchase.growthRate ?? 0,
      rmdEnabled: false,
      realization: purchase.realization,
    };
    newAccounts.push(newAccount);

    // Initialize ledger for new account
    accountBalances[newAccountId] = purchasePrice;
    basisMap[newAccountId] = assetBasis;
    accountLedgers[newAccountId] = {
      beginningValue: purchasePrice,
      growth: 0,
      contributions: purchasePrice,
      distributions: 0,
      rmdAmount: 0,
      fees: 0,
      endingValue: purchasePrice,
      entries: [
        {
          category: "savings_contribution",
          label: `Asset purchase: ${newAccount.name}`,
          amount: purchasePrice,
          sourceId: purchase.id,
        },
      ],
    };

    // Create synthetic liability for mortgage if provided
    if (mortgageAmount > 0 && purchase.mortgageRate !== undefined && purchase.mortgageTermMonths !== undefined) {
      const newLiabilityId = nextSyntheticId("technique-liab");
      const termMonths = purchase.mortgageTermMonths;
      const monthlyPayment = _calcMonthlyPayment(mortgageAmount, purchase.mortgageRate, termMonths);
      const liabilityName = `Mortgage: ${newAccount.name}`;
      const newLiability: Liability = {
        id: newLiabilityId,
        name: liabilityName,
        balance: mortgageAmount,
        interestRate: purchase.mortgageRate,
        monthlyPayment,
        startYear: year,
        startMonth: 1,
        termMonths: purchase.mortgageTermMonths,
        linkedPropertyId: newAccountId,
        isInterestDeductible: true,
        extraPayments: [],
      };
      newLiabilities.push(newLiability);
      syntheticLiabilityId = newLiabilityId;
      syntheticLiabilityName = liabilityName;
    }

    breakdown.push({
      transactionId: purchase.id,
      name: purchase.name,
      equity,
      purchasePrice,
      mortgageAmount,
      fundingAccountId,
      liabilityId: syntheticLiabilityId,
      liabilityName: syntheticLiabilityName,
    });
  }

  return { newAccounts, newLiabilities, breakdown };
}
