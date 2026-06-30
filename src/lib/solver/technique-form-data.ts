// Conversions between the engine technique types and the shapes the
// `add-*-form` components produce / consume. The asset-transaction form emits
// string-typed numeric fields (the persisting API normally coerces them);
// `coerceAssetTransactionDraft` does that coercion for the solver's draft path.

import type { AssetTransaction, RothConversion, Reinvestment, Relocation } from "@/engine/types";
import type { RothConversionInitialData } from "@/components/forms/add-roth-conversion-form";
import type { ReinvestmentInitialData } from "@/components/forms/add-reinvestment-form";
import type { AssetTransactionInitialData } from "@/components/forms/add-asset-transaction-form";
import type { RelocationInitialData } from "@/components/forms/add-relocation-form";

/** The asset-transaction form receives rate fields as decimal strings and
 *  multiplies them into percents on mount, so pass the decimal through. */
function numToString(value: number | undefined): string | null {
  return value != null ? String(value) : null;
}

/** Numeric fields the asset-transaction form emits as strings. */
const NUMERIC_FIELDS = [
  "purchasePrice",
  "growthRate",
  "basis",
  "overrideSaleValue",
  "overrideBasis",
  "transactionCostPct",
  "transactionCostFlat",
  "mortgageAmount",
  "mortgageRate",
  "mortgageTermMonths",
] as const;

/** Convert the asset-transaction form `body` (string numerics, explicit
 *  nulls) into a numeric `AssetTransaction`. Null / empty fields are dropped
 *  so optional engine fields stay `undefined`. */
export function coerceAssetTransactionDraft(
  body: Record<string, unknown>,
  id: string,
): AssetTransaction {
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(body)) {
    if (v === null || v === "" || v === undefined) continue;
    if ((NUMERIC_FIELDS as readonly string[]).includes(k)) {
      out[k] = Number(v);
    } else {
      out[k] = v;
    }
  }
  return out as unknown as AssetTransaction;
}

/** Engine RothConversion → the form's string-typed initial-data shape. */
export function toRothConversionInitialData(
  rc: RothConversion,
): RothConversionInitialData {
  return {
    id: rc.id,
    name: rc.name,
    destinationAccountId: rc.destinationAccountId,
    sourceAccountIds: rc.sourceAccountIds,
    conversionType: rc.conversionType,
    fixedAmount: String(rc.fixedAmount),
    fillUpBracket: rc.fillUpBracket != null ? String(rc.fillUpBracket) : null,
    startYear: rc.startYear,
    startYearRef: rc.startYearRef ?? null,
    endYear: rc.endYear ?? null,
    endYearRef: rc.endYearRef ?? null,
    indexingRate: String(rc.indexingRate),
    inflationStartYear: rc.inflationStartYear ?? null,
  };
}

/** Engine AssetTransaction → the form's string-typed initial-data shape.
 *  Dollar fields pass through as plain numeric strings; rate fields stay as
 *  decimal strings (the form multiplies them into percents on mount). */
export function toAssetTransactionInitialData(
  at: AssetTransaction,
): AssetTransactionInitialData {
  return {
    id: at.id,
    name: at.name,
    type: at.type,
    year: at.year,
    accountId: at.accountId ?? null,
    purchaseTransactionId: at.purchaseTransactionId ?? null,
    businessAccountId: at.businessAccountId ?? null,
    fractionSold:
      at.fractionSold != null ? String(at.fractionSold) : null,
    overrideSaleValue: numToString(at.overrideSaleValue),
    overrideBasis: numToString(at.overrideBasis),
    transactionCostPct: numToString(at.transactionCostPct),
    transactionCostFlat: numToString(at.transactionCostFlat),
    proceedsAccountId: at.proceedsAccountId ?? null,
    qualifiesForHomeSaleExclusion: at.qualifiesForHomeSaleExclusion ?? null,
    assetName: at.assetName ?? null,
    assetCategory: at.assetCategory ?? null,
    assetSubType: at.assetSubType ?? null,
    purchasePrice: numToString(at.purchasePrice),
    growthRate: numToString(at.growthRate),
    basis: numToString(at.basis),
    fundingAccountId: at.fundingAccountId ?? null,
    mortgageAmount: numToString(at.mortgageAmount),
    mortgageRate: numToString(at.mortgageRate),
    mortgageTermMonths: at.mortgageTermMonths ?? null,
  };
}

/** Engine Reinvestment → the form's initial-data shape. Solver drafts aren't
 *  persisted, so the form can't re-fetch the detail fields (modelPortfolioId /
 *  custom percents) — carry them through from the in-memory engine object. */
export function toReinvestmentInitialData(
  ri: Reinvestment,
): ReinvestmentInitialData {
  return {
    id: ri.id,
    name: ri.name,
    accountIds: ri.accountIds,
    groupKeys: ri.groupKeys ?? [],
    year: ri.year,
    yearRef: ri.yearRef ?? null,
    targetType: ri.targetType ?? "custom",
    realizeTaxesOnSwitch: ri.realizeTaxesOnSwitch,
    modelPortfolioId: ri.modelPortfolioId ?? null,
    customGrowthRate: ri.customGrowthRate ?? null,
    customPctOrdinaryIncome: ri.customPctOrdinaryIncome ?? null,
    customPctLtCapitalGains: ri.customPctLtCapitalGains ?? null,
    customPctQualifiedDividends: ri.customPctQualifiedDividends ?? null,
    customPctTaxExempt: ri.customPctTaxExempt ?? null,
  };
}

/** Engine Relocation → the form's initial-data shape. */
export function toRelocationInitialData(r: Relocation): RelocationInitialData {
  return {
    id: r.id,
    name: r.name,
    year: r.year,
    destinationState: r.destinationState,
  };
}
