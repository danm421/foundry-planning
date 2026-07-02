import type { Account, AccountLedger, AssetTransaction, Liability } from "./types";
import type { FilingStatus } from "../lib/tax/types";
import { LEGACY_FM_CLIENT, controllingEntity } from "./ownership";

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

// ── sellAccountFraction ───────────────────────────────────────────────────────

/** Sell `fraction` of a single account's balance. Mutates `accountBalances`,
 *  `basisMap`, and `accountLedgers` in place; returns the per-sale numbers
 *  the caller needs for capital-gain accumulation, proceeds routing, and
 *  cleanup.
 *
 *  Pure extraction from `applyAssetSales`: behavior on a non-business sale is
 *  unchanged. The business-sale cascade in `applyBusinessSales` calls this
 *  once per cascaded child account.
 *
 *  Note: this helper does NOT handle §121 home-sale exclusion or proceeds-
 *  account routing — those stay in `applyAssetSales` because entity-cascaded
 *  sales don't qualify for §121 and route proceeds differently.
 */
export interface SellAccountFractionInput {
  accountId: string;
  fraction: number; // 0 < fraction ≤ 1
  liabilities: Liability[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  accountLedgers: Record<string, AccountLedger>;
  saleLabel: string; // used in ledger entries — e.g. "Asset sale: <name>"
  saleId: string; // sourceId for the ledger entry
  overrideSaleValue?: number;
  overrideBasis?: number;
  transactionCostPct?: number;
  transactionCostFlat?: number;
}

export interface SellAccountFractionResult {
  saleValue: number;
  basis: number;
  transactionCosts: number;
  /** Net proceeds = saleValue − transactionCosts − mortgagePaidOff. */
  netProceeds: number;
  /** Raw capital gain (saleValue − basis, floored at 0), before any exclusion. */
  capitalGain: number;
  mortgagePaidOff: number;
  /** Set when this sale fully drained the account (fraction ≥ 1 or residual < $1). */
  removedAccountId?: string;
  removedLiabilityIds: string[];
  newBalance: number;
}

export function sellAccountFraction(
  input: SellAccountFractionInput,
): SellAccountFractionResult {
  const {
    accountId,
    fraction,
    liabilities,
    accountBalances,
    basisMap,
    accountLedgers,
    saleLabel,
    saleId,
    overrideSaleValue,
    overrideBasis,
    transactionCostPct,
    transactionCostFlat,
  } = input;

  const currentBalance = accountBalances[accountId] ?? 0;
  const currentBasis = basisMap[accountId] ?? 0;

  // Determine sale value and basis (use overrides when provided; else
  // prorate by fraction).
  const saleValue = overrideSaleValue ?? currentBalance * fraction;
  const basis = overrideBasis ?? currentBasis * fraction;

  // Calculate transaction costs
  const costPct = (transactionCostPct ?? 0) * saleValue;
  const costFlat = transactionCostFlat ?? 0;
  const transactionCosts = costPct + costFlat;

  // Amount-realized treatment: selling costs reduce the amount realized, so the
  // gain is (saleValue − transactionCosts) − basis, floored at 0.
  const capitalGain = Math.max(0, saleValue - transactionCosts - basis);

  // Net proceeds after costs
  let netProceeds = saleValue - transactionCosts;

  // Pay off linked mortgage only on full sales. Partial real-estate sales
  // route net proceeds to checking; the mortgage continues amortizing.
  let mortgagePaidOff = 0;
  const removedLiabilityIds: string[] = [];
  if (fraction >= 1) {
    const linkedMortgage = liabilities.find((l) => l.linkedPropertyId === accountId);
    if (linkedMortgage) {
      const mortgageBalance = linkedMortgage.balance;
      netProceeds -= mortgageBalance;
      mortgagePaidOff = mortgageBalance;
      removedLiabilityIds.push(linkedMortgage.id);
    }
  }

  // Drain the sold portion. fraction === 1 (or remaining < $1 from float
  // drift) zeroes the account and signals removal; partial sales leave
  // the residual.
  const newBalance = Math.max(0, currentBalance - saleValue);
  const newBasis = Math.max(0, currentBasis - basis);
  accountBalances[accountId] = newBalance;
  basisMap[accountId] = newBasis;

  let removedAccountId: string | undefined;
  if (fraction >= 1 || newBalance < 1) {
    removedAccountId = accountId;
  }

  // Update sold account ledger
  if (accountLedgers[accountId]) {
    accountLedgers[accountId].distributions -= saleValue;
    accountLedgers[accountId].endingValue = newBalance;
    accountLedgers[accountId].entries.push({
      category: "withdrawal",
      label: saleLabel,
      amount: -saleValue,
      sourceId: saleId,
      basis: -basis, // remove the sold lot's basis from the source account
    });
  }

  return {
    saleValue,
    basis,
    transactionCosts,
    netProceeds,
    capitalGain,
    mortgagePaidOff,
    removedAccountId,
    removedLiabilityIds,
    newBalance,
  };
}

// ── applyAssetSales ───────────────────────────────────────────────────────────

export interface AssetSaleBreakdown {
  transactionId: string;
  accountId: string;
  saleValue: number;
  basis: number;
  transactionCosts: number;
  netProceeds: number;
  /** Capital gain net of selling costs (saleValue − transactionCosts − basis, floored at 0), before the home-sale exclusion. */
  capitalGain: number;
  /** IRC §121 exclusion actually applied to this sale (0 unless the flag was set
   *  AND the account was real-estate AND there was gain to exclude). */
  homeSaleExclusionApplied: number;
  /** Gain that actually flows into taxable capital gains for the year. */
  taxableCapitalGain: number;
  mortgagePaidOff: number;
  proceedsAccountId: string;
  fractionSold: number;
  skipped?: "orphaned" | "no-source-balance";
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
  /** Map of entity id → that entity's default-checking account id. When a sold
   *  account is fully owned by an entity and the sale has no explicit
   *  `proceedsAccountId`, proceeds route to the entity's own checking rather
   *  than the household default — the cash belongs to the entity. Omitted (or
   *  missing the entity) falls back to `defaultCheckingId`. */
  entityCheckingByEntityId?: Record<string, string>;
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
    entityCheckingByEntityId,
  } = input;

  let totalCapitalGains = 0;
  let homeSaleExclusionTotal = 0;
  const removedAccountIds: string[] = [];
  const removedLiabilityIds: string[] = [];
  const breakdown: AssetSaleBreakdown[] = [];

  for (const sale of sales) {
    if (sale.type !== "sell" || sale.year !== year) continue;

    // Business-account-source sales are cascaded across child accounts by
    // applyBusinessSales; skip them here so we don't double-process.
    if (sale.businessAccountId) continue;

    const sourceAccountId = sale.accountId
      ?? (sale.purchaseTransactionId ? `technique-acct-${sale.purchaseTransactionId}` : null);

    // Skeleton breakdown shared by orphan + no-source-balance paths.
    const skeleton: AssetSaleBreakdown = {
      transactionId: sale.id,
      accountId: sourceAccountId ?? "",
      saleValue: 0, basis: 0, transactionCosts: 0, netProceeds: 0,
      capitalGain: 0, homeSaleExclusionApplied: 0, taxableCapitalGain: 0,
      mortgagePaidOff: 0, proceedsAccountId: "",
      fractionSold: sale.fractionSold ?? 1,
    };
    if (!sourceAccountId) {
      breakdown.push({ ...skeleton, skipped: "orphaned" });
      continue;
    }
    if (accountBalances[sourceAccountId] === undefined) {
      breakdown.push({ ...skeleton, skipped: "no-source-balance" });
      continue;
    }

    const accountId = sourceAccountId;
    const fraction = sale.fractionSold ?? 1;
    const soldAccount = accounts.find((a) => a.id === accountId);

    // Behavior-preserving extraction: sellAccountFraction handles the value/
    // basis math, mortgage payoff, balance drain, and sold-account ledger
    // entry. §121 exclusion + proceeds routing stay here.
    const result = sellAccountFraction({
      accountId,
      fraction,
      liabilities,
      accountBalances,
      basisMap,
      accountLedgers,
      saleLabel: `Asset sale: ${sale.name}`,
      saleId: sale.id,
      overrideSaleValue: sale.overrideSaleValue,
      overrideBasis: sale.overrideBasis,
      transactionCostPct: sale.transactionCostPct,
      transactionCostFlat: sale.transactionCostFlat,
    });

    const {
      saleValue,
      basis,
      transactionCosts,
      netProceeds,
      capitalGain,
      mortgagePaidOff,
      removedAccountId,
      removedLiabilityIds: saleRemovedLiabilityIds,
    } = result;

    if (removedAccountId) removedAccountIds.push(removedAccountId);
    for (const id of saleRemovedLiabilityIds) removedLiabilityIds.push(id);

    // IRC §121 home-sale exclusion. Applied only when the flag is set AND
    // the sold account's category is "real_estate" — the category gate is a
    // safety net against an errant true on a non-real-estate transaction.
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

    // Route net proceeds to destination account. An explicit proceedsAccountId
    // always wins. Otherwise, a fully-entity-owned source account routes to the
    // owning entity's checking (the proceeds belong to the entity, not the
    // household); fall back to the household default checking when the account
    // is household-owned or the entity has no checking on file.
    const owningEntityId = soldAccount?.owners ? controllingEntity(soldAccount) : null;
    const entityChecking =
      owningEntityId != null ? entityCheckingByEntityId?.[owningEntityId] : undefined;
    const proceedsAccountId =
      sale.proceedsAccountId ?? entityChecking ?? defaultCheckingId;
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
        // Asset→cash conversion, not operating income. Entity income rollups
        // exclude this; the taxable gain is recognized separately.
        isSaleProceeds: true,
        basis: netProceeds, // cash deposit: basis == amount (mirrors basisMap += netProceeds)
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
      fractionSold: sale.fractionSold ?? 1,
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
        basis: -basisDebit, // proportional basis removed from the funding account (== equity for cash)
      });
    }

    // Create synthetic account
    const newAccountId = `technique-acct-${purchase.id}`;
    const assetBasis = purchase.basis ?? purchasePrice;

    const newAccount: Account = {
      id: newAccountId,
      name: purchase.assetName ?? purchase.name,
      category: purchase.assetCategory ?? "taxable",
      subType: purchase.assetSubType ?? "other",
      titlingType: "jtwros",
      value: purchasePrice,
      basis: assetBasis,
      growthRate: purchase.growthRate ?? 0,
      rmdEnabled: false,
      realization: purchase.realization,
      // Technique-created assets default to household-owned (single client).
      // Mirrors the legacy `owner: "client"` semantics so portfolio rollups,
      // withdrawal sourcing, etc. treat the new asset as household property.
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      endingValue: purchasePrice,
      entries: [
        {
          category: "savings_contribution",
          label: `Asset purchase: ${newAccount.name}`,
          amount: purchasePrice,
          sourceId: purchase.id,
          basis: assetBasis, // seed the new asset's cost basis
        },
      ],
      basisBoY: assetBasis,
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
        // Technique-created mortgages default to household debt (single client),
        // mirroring migration 0055's "non-entity liabilities → client 100%" rule.
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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

// ── applyBusinessSales ────────────────────────────────────────────────────────

export interface BusinessSaleBreakdown {
  transactionId: string;
  businessAccountId: string;
  fractionSold: number;
  operatingSaleValue: number;
  operatingBasis: number;
  operatingGain: number;
  cascadedAccountIds: string[];
  cascadedLiabilityIds: string[];
  cascadedCapitalGain: number;
  totalCapitalGain: number;
  transactionCosts: number;
  totalLiabilityPaydown: number;
  netProceeds: number;
}

export interface BusinessSaleDiagnostic {
  transactionId: string;
  reason:
    | "business-not-found"
    | "business-already-sold"
    | "no-owners"
    | "invalid-fraction"
    | "no-default-checking";
}

export interface BusinessSalesResult {
  capitalGains: number;
  capitalGainsByOwner: Record<string, number>;
  removedAccountIds: string[];
  removedLiabilityIds: string[];
  removedBusinessAccountIds: string[];
  totalLiabilityPaydown: number;
  breakdown: BusinessSaleBreakdown[];
  diagnostics: BusinessSaleDiagnostic[];
}

export interface ApplyBusinessSalesInput {
  sales: AssetTransaction[];
  accounts: Account[];
  liabilities: Liability[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  accountLedgers: Record<string, AccountLedger>;
  year: number;
  defaultCheckingId: string;
}

/** Process all business-account-source asset sales for `year`.
 *
 *  Phase 4 model: businesses live as account rows (category === "business").
 *  Children — accounts/liabilities whose `parentAccountId` points at the
 *  business — are 100% owned by their parent (no fractional `account_owners`
 *  rows), so the cascade walks `parentAccountId` instead of the legacy
 *  entity-percent walk. No per-child owner rebalancing is needed.
 *
 *  Mutates the following caller-owned working state in place:
 *  - `accountBalances` / `basisMap` / `accountLedgers` — debited for cascaded
 *    child account sales; credited at `defaultCheckingId` for net proceeds.
 *  - `liability.balance` — paid down for each child liability, excluding
 *    those already settled inside `sellAccountFraction` (linked mortgages).
 *  - `business.value` — set to 0 on full sale, scaled by (1 − f) on partial.
 *  Returns aggregate results, removed IDs, breakdown, and diagnostics. */
export function applyBusinessSales(input: ApplyBusinessSalesInput): BusinessSalesResult {
  const {
    sales,
    accounts,
    liabilities,
    accountBalances,
    basisMap,
    accountLedgers,
    year,
    defaultCheckingId,
  } = input;

  let totalCapitalGains = 0;
  const capitalGainsByOwner: Record<string, number> = {};
  const removedAccountIds: string[] = [];
  const removedLiabilityIdsSet = new Set<string>();
  const removedBusinessAccountIds: string[] = [];
  let totalLiabilityPaydown = 0;
  const breakdown: BusinessSaleBreakdown[] = [];
  const diagnostics: BusinessSaleDiagnostic[] = [];

  for (const sale of sales) {
    if (sale.type !== "sell" || sale.year !== year) continue;
    if (!sale.businessAccountId) continue;

    const f = sale.fractionSold ?? 1;
    if (f <= 0 || f > 1) {
      diagnostics.push({ transactionId: sale.id, reason: "invalid-fraction" });
      continue;
    }

    const business = accounts.find(
      (a) =>
        a.id === sale.businessAccountId &&
        a.category === "business" &&
        a.parentAccountId == null,
    );
    if (!business) {
      diagnostics.push({ transactionId: sale.id, reason: "business-not-found" });
      continue;
    }
    if (removedBusinessAccountIds.includes(business.id)) {
      // Already fully sold earlier in this BoY pass — guard against multi-
      // sale collisions inside the same year.
      diagnostics.push({ transactionId: sale.id, reason: "business-already-sold" });
      continue;
    }
    if (business.owners.length === 0) {
      diagnostics.push({ transactionId: sale.id, reason: "no-owners" });
      continue;
    }

    // Operating-value sale on the business itself.
    const operatingValue = sale.overrideSaleValue ?? business.value ?? 0;
    const operatingBasis = sale.overrideBasis ?? business.basis ?? 0;
    const operatingGross = f * operatingValue;
    const operatingGain = Math.max(0, f * (operatingValue - operatingBasis));

    // Cascade through child accounts (parentAccountId === business.id).
    // Children are 100% owned by the parent so the per-owner walk used by
    // the legacy entity-sales path is unnecessary — fraction f applies
    // directly to each child's balance.
    const cascadedAccountIds: string[] = [];
    let cascadedGross = 0;
    let cascadedGain = 0;
    const liabilitiesSettledByAccountCascade = new Set<string>();
    for (const childAccount of accounts) {
      if (childAccount.parentAccountId !== business.id) continue;

      const cascadeResult = sellAccountFraction({
        accountId: childAccount.id,
        fraction: f,
        liabilities,
        accountBalances,
        basisMap,
        accountLedgers,
        saleLabel: `Business-cascade sale: ${business.name}`,
        saleId: sale.id,
        transactionCostPct: 0,
        transactionCostFlat: 0,
      });
      cascadedGross += cascadeResult.netProceeds;
      cascadedGain += cascadeResult.capitalGain;
      cascadedAccountIds.push(childAccount.id);
      if (cascadeResult.removedAccountId) {
        removedAccountIds.push(cascadeResult.removedAccountId);
      }
      for (const id of cascadeResult.removedLiabilityIds) {
        removedLiabilityIdsSet.add(id);
        liabilitiesSettledByAccountCascade.add(id);
      }
      totalLiabilityPaydown += cascadeResult.mortgagePaidOff;
    }

    // Cascade through child liabilities — e.g. an LLC mortgage not linked
    // to a specific property. Skip any already settled by the account
    // cascade to avoid double-paying linked mortgages.
    const cascadedLiabilityIds: string[] = [];
    let cascadedPaydown = 0;
    for (const childLiability of liabilities) {
      if (childLiability.parentAccountId !== business.id) continue;
      if (liabilitiesSettledByAccountCascade.has(childLiability.id)) continue;

      const paydown = f * childLiability.balance;
      if (paydown <= 0) continue;
      childLiability.balance = Math.max(0, childLiability.balance - paydown);
      cascadedPaydown += paydown;
      cascadedLiabilityIds.push(childLiability.id);
      if (f >= 1 || childLiability.balance <= 1) {
        removedLiabilityIdsSet.add(childLiability.id);
      }
    }

    // Transaction costs on combined gross (operating + cascaded child sales).
    const grossProceeds = operatingGross + cascadedGross;
    const costPct = (sale.transactionCostPct ?? 0) * grossProceeds;
    const costFlat = sale.transactionCostFlat ?? 0;
    const transactionCosts = costPct + costFlat;

    const netProceeds = grossProceeds - transactionCosts - cascadedPaydown;
    const totalCapitalGain = operatingGain + cascadedGain;

    // Capital-gain attribution to family-member owners pro-rata. Entity-kind
    // owners (e.g. a holdco) are recognized in totals but not attributed —
    // the upstream entity will receive distributions, not capital gain.
    const ownerSum = business.owners.reduce((s, o) => s + o.percent, 0);
    if (ownerSum > 0) {
      for (const owner of business.owners) {
        if (owner.kind !== "family_member") continue;
        const share = totalCapitalGain * (owner.percent / ownerSum);
        capitalGainsByOwner[owner.familyMemberId] =
          (capitalGainsByOwner[owner.familyMemberId] ?? 0) + share;
      }
    }
    totalCapitalGains += totalCapitalGain;
    totalLiabilityPaydown += cascadedPaydown;

    // Route proceeds to household default checking. If routing fails the
    // cap gain is still recognized but cash isn't deposited; emit a
    // diagnostic so the advisor wires up a default checking account.
    if (defaultCheckingId && accountBalances[defaultCheckingId] !== undefined) {
      accountBalances[defaultCheckingId] += netProceeds;
      basisMap[defaultCheckingId] = (basisMap[defaultCheckingId] ?? 0) + netProceeds;
      if (accountLedgers[defaultCheckingId]) {
        accountLedgers[defaultCheckingId].contributions += netProceeds;
        accountLedgers[defaultCheckingId].endingValue += netProceeds;
        accountLedgers[defaultCheckingId].entries.push({
          category: "income",
          label: `Business sale proceeds: ${business.name}`,
          amount: netProceeds,
          sourceId: sale.id,
          basis: netProceeds, // cash deposit: basis == amount (mirrors basisMap += netProceeds)
        });
      }
    } else {
      diagnostics.push({
        transactionId: sale.id,
        reason: "no-default-checking",
      });
    }

    // On a full sale, mark the business itself for removal; on partial,
    // scale its operating value so the residual interest persists.
    if (f >= 1) {
      removedBusinessAccountIds.push(business.id);
      removedAccountIds.push(business.id);
      business.value = 0;
      business.basis = 0;
    } else {
      business.value = operatingValue * (1 - f);
      // The sold tranche consumed f of the basis; the residual keeps (1 − f)
      // or a later tranche would compute its gain against the full original
      // basis and recognize $0.
      business.basis = operatingBasis * (1 - f);
    }

    breakdown.push({
      transactionId: sale.id,
      businessAccountId: business.id,
      fractionSold: f,
      operatingSaleValue: operatingValue,
      operatingBasis,
      operatingGain,
      cascadedAccountIds,
      cascadedLiabilityIds,
      cascadedCapitalGain: cascadedGain,
      totalCapitalGain,
      transactionCosts,
      totalLiabilityPaydown: cascadedPaydown,
      netProceeds,
    });
  }

  return {
    capitalGains: totalCapitalGains,
    capitalGainsByOwner,
    removedAccountIds,
    removedLiabilityIds: Array.from(removedLiabilityIdsSet),
    removedBusinessAccountIds,
    totalLiabilityPaydown,
    breakdown,
    diagnostics,
  };
}
