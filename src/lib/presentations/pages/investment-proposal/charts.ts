// Chart specs for the Investment Proposal page, built from the FROZEN snapshot.
//
// Neither of the shared builders fits:
//  · `buildAllocationDonutSpec` needs `assetType` + `sortOrder` per class; a
//    frozen `NamedWeight` carries neither, and re-reading them live would let a
//    presented page's colors drift.
//  · `buildScatterSpec` colors and legends from `AnalysisRow["type"]`, whose
//    values are account/portfolio series — a current-vs-proposed chart built
//    through it prints a legend reading "Accounts / Model Portfolios".
// Both RENDERERS (`DonutPdf`, `ScatterPdf`) are reused unchanged.
import { colorForAssetClass } from "@/lib/investments/palette";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { DonutSpec, DonutSegment, ScatterSpec } from "@/lib/presentations/charts/types";
import type { NamedWeight } from "@/lib/investments/rebalance/types";
import type { RiskReturnStats } from "@/lib/investments/portfolio-stats";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/**
 * One ring, one segment per asset class, colored by the class's POSITION in the
 * frozen mix. Position rather than a live sort order on purpose: the snapshot's
 * array order is itself frozen, so the same proposal prints the same colors
 * forever, and current/proposed share a palette because both mixes come out of
 * the same snapshot in the same class order.
 */
export function buildProposalDonutSpec(mix: NamedWeight[], centerLabel: string): DonutSpec {
  const total = mix.reduce((s, m) => s + Math.max(0, m.weight), 0);
  const segments: DonutSegment[] = mix.map((m, i) => ({
    key: m.assetClassId,
    label: m.name,
    value: m.weight,
    color: colorForAssetClass({ id: m.assetClassId, sortOrder: i }),
    fraction: total > 0 ? Math.max(0, m.weight) / total : 0,
  }));
  return {
    kind: "donut",
    size: 150,
    rings: [{ segments }],
    centerLabel,
    legend: segments.map((s) => ({ label: s.label, color: s.color, pct: s.fraction })),
  };
}

/** Pad a [min,max] pair outward by 20% of its span so neither point sits on an
 *  axis, and never return a zero-width domain. */
function paddedDomain(a: number, b: number): [number, number] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const span = hi - lo;
  const pad = span > 0 ? span * 0.2 : Math.max(0.01, Math.abs(hi) * 0.2);
  return [Math.max(0, lo - pad), hi + pad];
}

function ticksFor([lo, hi]: [number, number]): number[] {
  const step = (hi - lo) / 4;
  return [0, 1, 2, 3, 4].map((i) => lo + step * i);
}

/**
 * Two points: where the portfolio is, and where the proposal puts it. x is
 * volatility, y is the arithmetic mean — the same axes `buildScatterSpec` uses,
 * so the page reads the same way as Portfolio Analysis.
 */
export function buildProposalScatterSpec(
  current: RiskReturnStats,
  proposed: RiskReturnStats,
): ScatterSpec {
  const xDomain = paddedDomain(current.stdDev, proposed.stdDev);
  const yDomain = paddedDomain(current.arithmeticMean, proposed.arithmeticMean);
  const items = [
    { label: "Current", color: T.ink3, pointStyle: "circle" as const },
    { label: "Proposed", color: T.accent, pointStyle: "star" as const },
  ];
  return {
    kind: "scatter",
    width: 430,
    height: 250,
    margin: { top: 12, right: 16, bottom: 34, left: 46 },
    gridlineColor: T.hair2,
    xAxis: { domain: xDomain, ticks: ticksFor(xDomain), labelFormat: pct, title: "Volatility" },
    yAxis: { domain: yDomain, ticks: ticksFor(yDomain), labelFormat: pct, title: "Expected return" },
    points: [
      { key: "current", label: "Current", x: current.stdDev, y: current.arithmeticMean, color: items[0].color, pointStyle: items[0].pointStyle },
      { key: "proposed", label: "Proposed", x: proposed.stdDev, y: proposed.arithmeticMean, color: items[1].color, pointStyle: items[1].pointStyle },
    ],
    legend: { items },
  };
}
