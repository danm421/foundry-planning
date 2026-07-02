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
    const name = ctx.rothConversionNames?.[cid];
    return name ? `${name} — Roth Conversion` : "Roth Conversion";
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
    return name ? `${name} — K-1` : "Entity Pass-Through";
  }
  if (sourceId.startsWith("business_passthrough:")) {
    const acctId = sourceId.slice("business_passthrough:".length);
    const name = ctx.accountNames[acctId];
    return name ? `${name} — Pass-Through` : "Business Pass-Through";
  }
  if (sourceId.startsWith("clt_recapture:")) {
    return `CLT recapture (${sourceId.slice("clt_recapture:".length)})`;
  }
  if (sourceId.startsWith("note:")) {
    // Shape: `note:<noteId>:<kind>` where kind ∈ {"interest", "ltcg"}.
    const rest = sourceId.slice("note:".length);
    const lastColon = rest.lastIndexOf(":");
    const noteId = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
    const kind = lastColon >= 0 ? rest.slice(lastColon + 1) : "";
    const kindLabel = kind === "interest"
      ? "interest"
      : kind === "ltcg"
        ? "capital gain"
        : kind || "";
    const name = ctx.noteNames?.[noteId] ?? "Note";
    return kindLabel ? `${name} — ${kindLabel}` : name;
  }
  if (sourceId.startsWith("equity-vest:")) {
    const planId = sourceId.slice("equity-vest:".length);
    return `${ctx.equityPlanNames?.[planId] ?? planId} — vest`;
  }
  if (sourceId.startsWith("equity-ltcg:")) {
    const planId = sourceId.slice("equity-ltcg:".length);
    return `${ctx.equityPlanNames?.[planId] ?? planId} — sale`;
  }
  if (sourceId.startsWith("equity-stcg:")) {
    const planId = sourceId.slice("equity-stcg:".length);
    return `${ctx.equityPlanNames?.[planId] ?? planId} — sale (ST)`;
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

export { formatCurrency } from "@/lib/cell-drill/format";

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
