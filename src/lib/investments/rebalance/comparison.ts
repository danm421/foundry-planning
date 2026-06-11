import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { NamedWeight, DeltaRow, TradeRow } from "./types";

const HOLD_EPS = 1e-9;

export function toNamedWeights(
  weights: readonly AssetClassWeight[],
  names: ReadonlyMap<string, string>,
): NamedWeight[] {
  return weights.map((w) => ({
    assetClassId: w.assetClassId,
    name: names.get(w.assetClassId) ?? "Unclassified",
    weight: w.weight,
  }));
}

function unionRows(
  current: readonly NamedWeight[],
  target: readonly NamedWeight[],
): { assetClassId: string; name: string; cur: number; tgt: number }[] {
  const byId = new Map<string, { assetClassId: string; name: string; cur: number; tgt: number }>();
  const upsert = (w: NamedWeight, side: "cur" | "tgt") => {
    const row = byId.get(w.assetClassId) ?? { assetClassId: w.assetClassId, name: w.name, cur: 0, tgt: 0 };
    row[side] = w.weight;
    if (w.name && row.name === "Unclassified") row.name = w.name;
    byId.set(w.assetClassId, row);
  };
  current.forEach((w) => upsert(w, "cur"));
  target.forEach((w) => upsert(w, "tgt"));
  return [...byId.values()];
}

export function buildAssetMixDelta(
  current: readonly NamedWeight[],
  target: readonly NamedWeight[],
): DeltaRow[] {
  return unionRows(current, target)
    .map((r) => ({
      assetClassId: r.assetClassId,
      name: r.name,
      currentPct: r.cur,
      targetPct: r.tgt,
      diffPct: r.tgt - r.cur,
    }))
    .sort((a, b) => b.targetPct - a.targetPct);
}

export function buildTradeSummary(
  current: readonly NamedWeight[],
  target: readonly NamedWeight[],
  totalValue: number,
): TradeRow[] {
  return unionRows(current, target)
    .map((r) => {
      const currentValue = r.cur * totalValue;
      const targetValue = r.tgt * totalValue;
      const deltaValue = targetValue - currentValue;
      const action: TradeRow["action"] =
        deltaValue > HOLD_EPS ? "buy" : deltaValue < -HOLD_EPS ? "sell" : "hold";
      return { assetClassId: r.assetClassId, name: r.name, currentValue, targetValue, deltaValue, action };
    })
    .sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
}
