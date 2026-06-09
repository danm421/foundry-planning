// src/lib/tax-ledger/_shared.ts
import type { TaxCharacter, TaxLedgerRow } from "./types";

/** Sum signed row amounts grouped by tax character. */
export function subtotalByCharacter(rows: TaxLedgerRow[]): Partial<Record<TaxCharacter, number>> {
  const out: Partial<Record<TaxCharacter, number>> = {};
  for (const r of rows) out[r.character] = (out[r.character] ?? 0) + r.amount;
  return out;
}
