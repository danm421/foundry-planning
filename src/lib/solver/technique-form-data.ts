// src/lib/solver/technique-form-data.ts
//
// Conversions between the engine technique types and the shapes the
// `add-*-form` components produce / consume. The asset-transaction form emits
// string-typed numeric fields (the persisting API normally coerces them);
// `coerceAssetTransactionDraft` does that coercion for the solver's draft path.

import type { AssetTransaction, RothConversion, Reinvestment } from "@/engine/types";
import type { RothConversionInitialData } from "@/components/forms/add-roth-conversion-form";
import type { ReinvestmentInitialData } from "@/components/forms/add-reinvestment-form";

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

/** Engine Reinvestment → the form's initial-data shape. The form re-fetches
 *  detail fields (modelPortfolioId / custom percents) on mount, so only the
 *  card-level fields are needed here. */
export function toReinvestmentInitialData(
  ri: Reinvestment,
): ReinvestmentInitialData {
  return {
    id: ri.id,
    name: ri.name,
    accountIds: ri.accountIds,
    year: ri.year,
    yearRef: ri.yearRef ?? null,
    targetType: ri.targetType ?? "custom",
    realizeTaxesOnSwitch: ri.realizeTaxesOnSwitch,
  };
}
