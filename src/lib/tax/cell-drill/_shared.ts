import type { CellDrillContext, CellDrillRow } from "./types";

const COMPOUND_KIND_LABEL: Record<string, string> = {
  oi: "OI",
  qdiv: "Qual Div",
  stcg: "ST CG",
  rmd: "RMD",
};

/** One `taxDetail.bySource` row. Mirrors `ProjectionYear["taxDetail"]["bySource"]`. */
export type BySourceEntry = { type: string; amount: number; irmaaCapTier?: number };

/** Resolve a `taxDetail.bySource` key to a display label.
 *
 *  `entry` is the ROW the key points at, and is optional only because a couple
 *  of callers label a bare key. Pass it whenever you have it: a per-YEAR
 *  outcome such as "this conversion was cut by the IRMAA cap" can only be read
 *  off the row. `ctx` is built once for every year of the projection, so a
 *  reason stored there would label 2030 and 2031 identically even when the cap
 *  bound in only one of them. */
export function resolveSourceLabel(
  sourceId: string,
  ctx: CellDrillContext,
  entry?: BySourceEntry,
): string {
  if (sourceId.startsWith("withdrawal:")) {
    const acctId = sourceId.slice("withdrawal:".length);
    const name = ctx.accountNames[acctId] ?? acctId;
    return `${name} — Withdrawal`;
  }
  if (sourceId.startsWith("withdrawal_tax_free:")) {
    const acctId = sourceId.slice("withdrawal_tax_free:".length);
    const name = ctx.accountNames[acctId] ?? acctId;
    return `${name} — Withdrawal (tax-free)`;
  }
  if (sourceId.startsWith("annuity_tax_free:")) {
    const acctId = sourceId.slice("annuity_tax_free:".length);
    const name = ctx.accountNames[acctId] ?? acctId;
    return `${name} — Annuity Income (tax-free)`;
  }
  if (sourceId.startsWith("annuity:")) {
    const acctId = sourceId.slice("annuity:".length);
    const name = ctx.accountNames[acctId] ?? acctId;
    return `${name} — Annuity Income`;
  }
  if (sourceId.startsWith("education_tax_free:")) {
    return "Education funding — non-taxable distribution";
  }
  if (sourceId.startsWith("education_capital:")) {
    return "Education funding — capital gain";
  }
  if (sourceId.startsWith("education:")) {
    return "Education funding — taxable distribution";
  }
  if (sourceId.startsWith("roth_conversion:")) {
    const cid = sourceId.slice("roth_conversion:".length);
    const name = ctx.rothConversionNames?.[cid];
    const base = name ? `${name} — Roth Conversion` : "Roth Conversion";
    const tier = entry?.irmaaCapTier;
    return tier != null ? `${base} (limited by IRMAA Tier ${tier})` : base;
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

type BySource = Record<string, BySourceEntry>;

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
    .map(([id, v]) => ({ id, label: resolveSourceLabel(id, ctx, v), amount: v.amount }))
    .sort((a, b) => b.amount - a.amount);
}
