// src/lib/reports/tax-cell-drill/_shared.ts
import type { CellDrillContext } from "./types";

const COMPOUND_KIND_LABEL: Record<string, string> = {
  oi: "OI",
  qdiv: "Qual Div",
  stcg: "ST CG",
  rmd: "RMD",
};

/** Resolve a `taxDetail.bySource` key to a display label. Mirrors and replaces
 *  the inline logic that used to live in tax-drill-down-modal.tsx. */
export function resolveSourceLabel(sourceId: string, ctx: CellDrillContext): string {
  if (sourceId.startsWith("withdrawal:")) {
    const acctId = sourceId.slice("withdrawal:".length);
    const name = ctx.accountNames[acctId] ?? acctId;
    return `${name} — Withdrawal`;
  }
  if (sourceId.startsWith("roth_conversion:")) {
    const cid = sourceId.slice("roth_conversion:".length);
    return `Roth conversion (${cid})`;
  }
  if (sourceId.startsWith("sale:")) {
    const tx = sourceId.slice("sale:".length);
    return `Asset sale (${tx})`;
  }
  if (sourceId.startsWith("transfer:")) {
    const t = sourceId.slice("transfer:".length);
    return `Transfer (${t})`;
  }
  if (sourceId.startsWith("entity_passthrough:")) {
    const e = sourceId.slice("entity_passthrough:".length);
    return `Entity pass-through (${e})`;
  }
  if (sourceId.startsWith("clut_recapture:")) {
    return `CLUT recapture (${sourceId.slice("clut_recapture:".length)})`;
  }
  if (sourceId.includes(":")) {
    const [acctId, kind] = sourceId.split(":");
    const name = ctx.accountNames[acctId] ?? acctId;
    const kindLabel = COMPOUND_KIND_LABEL[kind] ?? kind.toUpperCase();
    return `${name} — ${kindLabel}`;
  }
  const inc = ctx.incomes.find((i) => i.id === sourceId);
  if (inc) return inc.name;
  return sourceId;
}

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCurrency(n: number): string {
  return usdFmt.format(n);
}
