import type { CellDrillContext, CellDrillRow } from "./types";

const COMPOUND_KIND_LABEL: Record<string, string> = {
  oi: "OI",
  qdiv: "Qual Div",
  stcg: "ST CG",
  rmd: "RMD",
};

/** Resolve a `taxDetail.bySource` key to a display label. */
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
    const name = ctx.entityNames?.[e];
    return name ? `${name} — K-1` : `Entity pass-through (${e})`;
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

type BySource = Record<string, { type: string; amount: number }>;

/** Build descending-by-amount drill rows from a `taxDetail.bySource` map,
 *  filtered by one type or a set of types. */
export function bySourceRows(
  bySource: BySource,
  match: string | ReadonlySet<string>,
  ctx: CellDrillContext,
): CellDrillRow[] {
  const matches =
    typeof match === "string"
      ? (t: string) => t === match
      : (t: string) => match.has(t);
  return Object.entries(bySource)
    .filter(([, v]) => matches(v.type))
    .map(([id, v]) => ({ id, label: resolveSourceLabel(id, ctx), amount: v.amount }))
    .sort((a, b) => b.amount - a.amount);
}
