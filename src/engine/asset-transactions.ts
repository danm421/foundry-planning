import type { Account, AccountLedger, AssetTransaction, Liability } from "./types";

// ── Synthetic ID counter ──────────────────────────────────────────────────────

let _syntheticIdCounter = 0;

export function _resetSyntheticIdCounter(): void {
  _syntheticIdCounter = 0;
}

// ── applyAssetSales ───────────────────────────────────────────────────────────

export interface AssetSaleBreakdown {
  transactionId: string;
  accountId: string;
  saleValue: number;
  basis: number;
  transactionCosts: number;
  netProceeds: number;
  capitalGain: number;
  mortgagePaidOff: number;
  proceedsAccountId: string;
}

export interface AssetSalesResult {
  capitalGains: number;
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
}

export function applyAssetSales(input: ApplyAssetSalesInput): AssetSalesResult {
  const {
    sales,
    liabilities,
    accountBalances,
    basisMap,
    accountLedgers,
    year,
    defaultCheckingId,
  } = input;

  let totalCapitalGains = 0;
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
    totalCapitalGains += capitalGain;

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
      mortgagePaidOff,
      proceedsAccountId,
    });
  }

  return { capitalGains: totalCapitalGains, removedAccountIds, removedLiabilityIds, breakdown };
}

// ── applyAssetPurchases ───────────────────────────────────────────────────────

export interface AssetPurchasesResult {
  newAccounts: Account[];
  newLiabilities: Liability[];
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

  for (const purchase of purchases) {
    if (purchase.type !== "buy" || purchase.year !== year) continue;

    const purchasePrice = purchase.purchasePrice ?? 0;
    const mortgageAmount = purchase.mortgageAmount ?? 0;
    const equity = purchasePrice - mortgageAmount;

    // Determine funding source
    const fundingAccountId = purchase.fundingAccountId ?? defaultCheckingId;

    // Debit equity from funding account
    accountBalances[fundingAccountId] = (accountBalances[fundingAccountId] ?? 0) - equity;
    basisMap[fundingAccountId] = (basisMap[fundingAccountId] ?? 0) - equity;

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
    const newAccountId = `technique-acct-${++_syntheticIdCounter}`;
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
      const newLiabilityId = `technique-liab-${++_syntheticIdCounter}`;
      const termMonths = purchase.mortgageTermMonths;
      const monthlyPayment = _calcMonthlyPayment(mortgageAmount, purchase.mortgageRate, termMonths);
      const termYears = Math.ceil(termMonths / 12);

      const newLiability: Liability = {
        id: newLiabilityId,
        name: `Mortgage: ${newAccount.name}`,
        balance: mortgageAmount,
        interestRate: purchase.mortgageRate,
        monthlyPayment,
        startYear: year,
        endYear: year + termYears,
        linkedPropertyId: newAccountId,
        isInterestDeductible: true,
      };
      newLiabilities.push(newLiability);
    }
  }

  return { newAccounts, newLiabilities };
}
