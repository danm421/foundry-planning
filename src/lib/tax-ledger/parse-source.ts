// src/lib/tax-ledger/parse-source.ts
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { resolveSourceLabel } from "@/lib/tax/cell-drill/_shared";
import { isTaxableCharacter, rawTypeToCharacter } from "./character";
import type { TaxLedgerRow } from "./types";

interface RawEntry {
  type: string;
  amount: number;
}

const INCOME_TYPE_LABELS: Record<string, string> = {
  salary: "Salary / Wages",
  social_security: "Social Security",
  business: "Business Income",
  deferred: "Pension / Deferred",
  capital_gains: "Capital Gain",
  trust: "Trust Income",
  other: "Other Income",
};

/**
 * Turn one `taxDetail.bySource` entry into a structured ledger row.
 * Key formats are the verbatim strings the engine writes in
 * src/engine/projection.ts — keep in sync if the engine changes them.
 */
export function parseHouseholdSource(
  key: string,
  entry: RawEntry,
  ctx: CellDrillContext,
): TaxLedgerRow {
  const character = rawTypeToCharacter(entry.type);
  const amount = entry.amount;
  const taxable = isTaxableCharacter(character);

  if (key.startsWith("business_passthrough:")) {
    const id = key.slice("business_passthrough:".length);
    const name = ctx.entityNames?.[id] ?? "Business";
    return { type: "K-1 Pass-Thru Income", description: `${name} — K-1`, character, account: null, amount, taxable };
  }
  if (key.startsWith("roth_conversion:")) {
    const id = key.slice("roth_conversion:".length);
    return { type: "Roth Conversion", description: ctx.rothConversionNames?.[id] ?? "Roth Conversion", character, account: null, amount, taxable };
  }
  if (key.startsWith("note:")) {
    const rest = key.slice("note:".length);
    const lastColon = rest.lastIndexOf(":");
    const noteId = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
    const kind = lastColon >= 0 ? rest.slice(lastColon + 1) : "";
    const name = ctx.noteNames?.[noteId] ?? "Installment Note";
    const kindLabel = kind === "interest" ? "Interest" : "Capital Gain";
    return { type: `Installment Sale — ${kindLabel}`, description: name, character, account: null, amount, taxable };
  }
  if (key.startsWith("business_sale:")) {
    return { type: "Business Sale", description: "Capital gain on business sale", character, account: null, amount, taxable };
  }
  if (key.startsWith("sale:")) {
    return { type: "Asset Sale", description: "Capital gain on sale", character, account: null, amount, taxable };
  }
  if (key.startsWith("reinvestment:")) {
    return { type: "Reinvestment", description: "Realized capital gain", character, account: null, amount, taxable };
  }
  if (key.startsWith("equity-vest:") || key.startsWith("equity-ltcg:") || key.startsWith("equity-stcg:")) {
    const colon = key.indexOf(":");
    const prefix = key.slice(0, colon);
    const planId = key.slice(colon + 1);
    const name = ctx.equityPlanNames?.[planId] ?? "Equity Plan";
    const label = prefix === "equity-vest" ? "Equity Vest/Exercise" : "Equity Sale";
    return { type: label, description: name, character, account: null, amount, taxable };
  }
  if (key.startsWith("withdrawal:")) {
    const acctId = key.slice("withdrawal:".length);
    return { type: "Withdrawal", description: "Supplemental withdrawal", character, account: ctx.accountNames[acctId] ?? acctId, amount, taxable };
  }
  if (key.startsWith("withdrawal_tax_free:")) {
    const acctId = key.slice("withdrawal_tax_free:".length);
    return { type: "Withdrawal", description: "Non-taxable distribution", character, account: ctx.accountNames[acctId] ?? acctId, amount, taxable };
  }
  if (key.startsWith("transfer:")) {
    return { type: "Transfer", description: "Taxable in-kind transfer", character, account: null, amount, taxable };
  }
  if (key.startsWith("crt_distribution:")) {
    const id = key.slice("crt_distribution:".length);
    return { type: "CRT Distribution", description: ctx.entityNames?.[id] ?? "CRT", character, account: null, amount, taxable };
  }
  if (key.startsWith("clt_recapture:")) {
    const id = key.slice("clt_recapture:".length);
    return { type: "CLT Recapture", description: ctx.entityNames?.[id] ?? "CLT", character, account: null, amount, taxable };
  }
  if (key.startsWith("entity_gap_fill_prior_year:")) {
    return { type: "Entity Carry-In Gain", description: "Prior-year grantor carry-in", character, account: null, amount, taxable };
  }

  // Portfolio realization & RMD: <acctId>:oi|qdiv|stcg|rmd  (also 3-segment <acctId>:<kind>:<entityId>)
  if (key.includes(":")) {
    const segs = key.split(":");
    const acctId = segs[0];
    const kind = segs[1];
    const type = kind === "rmd" ? "RMD" : "Investment Income";
    const description =
      kind === "rmd" ? "Required minimum distribution" :
      kind === "qdiv" ? "Qualified dividends" :
      kind === "stcg" ? "Short-term gain" :
      kind === "oi" ? "Ordinary investment income" : kind.toUpperCase();
    return { type, description, character, account: ctx.accountNames[acctId] ?? acctId, amount, taxable };
  }

  // Bare income-row id.
  const inc = ctx.incomes.find((i) => i.id === key);
  if (inc) {
    return { type: INCOME_TYPE_LABELS[inc.type] ?? "Income", description: inc.name, character, account: null, amount, taxable };
  }

  // Unknown — fall back to the shared resolver for a best-effort label.
  return { type: "Other", description: resolveSourceLabel(key, ctx), character, account: null, amount, taxable };
}
