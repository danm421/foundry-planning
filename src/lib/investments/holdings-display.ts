import { rollupHoldings, type HoldingInput } from "./holdings-rollup";
import type { HoldingRow } from "./holdings-client";
import { isLockedSystemAssetClass } from "./asset-class-slugs";

/** Minimal asset-class shape the display layer needs (matches AssetClassOption,
 *  but slug is the only extra field required here besides id+name). */
export interface AssetClassLite {
  id: string;
  name: string;
  slug: string | null;
}

function slugMap(assetClasses: readonly AssetClassLite[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const ac of assetClasses) if (ac.slug) m.set(ac.slug, ac.id);
  return m;
}

/** Enriched API rows → rollup input shape (string numerics parsed). */
export function toHoldingInputs(rows: readonly HoldingRow[]): HoldingInput[] {
  return rows.map((r) => ({
    id: r.id,
    securityId: r.securityId,
    shares: parseFloat(r.shares),
    price: parseFloat(r.price),
    costBasis: parseFloat(r.costBasis),
    securityWeights: r.securityWeights,
    overrides: r.overrides,
  }));
}

export interface HoldingsSummary {
  value: number;
  basis: number;
  /** Value-weighted blend, named, sorted by weight desc. */
  blend: { assetClassId: string; name: string; weight: number }[];
  /** Unclassified fraction (1 − Σ blend weight) routed to inflation by the engine. */
  residual: number;
}

export function summarizeHoldings(
  rows: readonly HoldingRow[],
  assetClasses: readonly AssetClassLite[],
): HoldingsSummary {
  const nameById = new Map(assetClasses.map((ac) => [ac.id, ac.name]));
  const r = rollupHoldings(toHoldingInputs(rows), slugMap(assetClasses));
  const blend = r.allocations.map((a) => ({
    assetClassId: a.assetClassId,
    name: nameById.get(a.assetClassId) ?? "Unknown",
    weight: a.weight,
  }));
  const total = blend.reduce((s, b) => s + b.weight, 0);
  return { value: r.value, basis: r.basis, blend, residual: Math.max(0, 1 - total) };
}

export type RowChip =
  | { kind: "derived"; label: string }
  | { kind: "manual"; label: string }
  | { kind: "needs_review"; label: string }
  | { kind: "locked"; label: string };

/** The per-row asset-class chip: Manual (override) > Needs review (nothing) >
 *  single class name > Blend (n). */
export function rowChip(row: HoldingRow, assetClasses: readonly AssetClassLite[]): RowChip {
  if (row.overrides.length > 0) return { kind: "manual", label: "Manual" };
  if (row.needsReview || row.securityWeights.length === 0)
    return { kind: "needs_review", label: "Needs review" };
  if (row.securityWeights.length === 1) {
    const only = row.securityWeights[0];
    const name = assetClasses.find((ac) => ac.slug === only.slug)?.name;
    if (isLockedSystemAssetClass(only.slug)) return { kind: "locked", label: name ?? "Cash" };
    return { kind: "derived", label: name ?? "Needs review" };
  }
  return { kind: "derived", label: `Blend (${row.securityWeights.length})` };
}
