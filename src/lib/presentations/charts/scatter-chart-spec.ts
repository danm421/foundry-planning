import { dataLight } from "@/brand";
import { ticks as d3ticks } from "d3-array";
import type { ScatterSpec, ScatterPoint } from "./types";
import type { AnalysisRow, EntityType } from "@/lib/investments/portfolio-analysis";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";

// Series colors mirror the first five entries of PALETTE in lib/investments/palette.ts.
// Kept independent here because scatter series are entity-type categories, not asset classes.
const SERIES: Record<
  EntityType,
  { label: string; pointStyle: ScatterPoint["pointStyle"]; color: string }
> = {
  asset_class: { label: "Asset Classes", pointStyle: "circle", color: dataLight.blue },
  account: { label: "Accounts", pointStyle: "rect", color: dataLight.green },
  category: { label: "Account Categories", pointStyle: "triangle", color: dataLight.yellow },
  custom_group: { label: "Custom Groups", pointStyle: "rectRot", color: dataLight.purple },
  model_portfolio: { label: "Model Portfolios", pointStyle: "star", color: dataLight.pink },
};

/** Snap [min,max] to whole percents, padding -4pp below and +1pp above.
 *  The lower bound clamps to 0 for non-negative data; for all-negative data
 *  this would yield [0,0], so we guarantee hi > lo by at least 0.01. */
export function snapPercentDomain(values: number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Floor/ceil to whole percent boundaries, then pad outward.
  const floorPct = Math.floor(Math.round(lo * 1000) / 10) / 100;
  const ceilPct = Math.ceil(Math.round(hi * 1000) / 10) / 100;
  const lower = Math.max(0, Math.round((floorPct - 0.04) * 100) / 100);
  const upper = Math.round((ceilPct + 0.01) * 100) / 100;
  return [lower, Math.max(upper, lower + 0.01)];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function buildScatterSpec(rows: AnalysisRow[]): ScatterSpec {
  const xs = rows.map((r) => r.stats.stdDev);
  const ys = rows.map((r) => r.stats.arithmeticMean);
  const xDomain: [number, number] = rows.length
    ? snapPercentDomain(xs)
    : [0, 0.2];
  const yDomain: [number, number] = rows.length
    ? snapPercentDomain(ys)
    : [0, 0.1];

  const points: ScatterPoint[] = rows.map((r) => ({
    key: r.key,
    label: r.name,
    x: r.stats.stdDev,
    y: r.stats.arithmeticMean,
    color: SERIES[r.type].color,
    pointStyle: SERIES[r.type].pointStyle,
  }));

  const typesPresent = [...new Set(rows.map((r) => r.type))];

  return {
    kind: "scatter",
    width: 360,
    height: 300,
    margin: { top: 16, right: 16, bottom: 48, left: 52 },
    gridlineColor: PRESENTATION_THEME.hair,
    xAxis: {
      domain: xDomain,
      ticks: d3ticks(xDomain[0], xDomain[1], 5),
      labelFormat: pct,
      title: "Risk (σ)",
    },
    yAxis: {
      domain: yDomain,
      ticks: d3ticks(yDomain[0], yDomain[1], 5),
      labelFormat: pct,
      title: "Return",
    },
    points,
    legend: {
      items: typesPresent.map((t) => ({
        label: SERIES[t].label,
        color: SERIES[t].color,
        pointStyle: SERIES[t].pointStyle,
      })),
    },
  };
}
