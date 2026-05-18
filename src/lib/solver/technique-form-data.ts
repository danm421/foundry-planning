// src/lib/solver/technique-form-data.ts
//
// Conversions between the engine technique types and the shapes the
// `add-*-form` components produce / consume. The asset-transaction form emits
// string-typed numeric fields (the persisting API normally coerces them);
// `coerceAssetTransactionDraft` does that coercion for the solver's draft path.

import type { AssetTransaction } from "@/engine/types";

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
