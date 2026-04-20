import type { MonteCarloSummary } from "@/engine";

export interface FanChartDataset {
  label: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  borderDash?: number[];
  pointRadius?: number;
  fill: false | "+1" | "-1";
  tension?: number;
  order?: number;
}

export interface FanChartSeries {
  ages: number[];
  datasets: FanChartDataset[];
}

const LINE_P80 = "rgb(52, 211, 153)";             // emerald-400 — above-average outcome
const LINE_P50 = "rgb(110, 231, 183)";            // emerald-300 — median
const LINE_P20 = "rgb(251, 113, 133)";            // rose-400 — below-average outcome
const LINE_DETERMINISTIC = "rgb(148, 163, 184)";  // slate-400 — fixed-rate cash-flow projection

// Band fill covers the area between p80 (upper boundary) and p20 (lower boundary).
// Emerald @ 15% — subtle enough to let the median line dominate.
const BAND_FILL = "rgba(52, 211, 153, 0.15)";

export function buildFanChartSeries(
  byYear: MonteCarloSummary["byYear"],
  deterministic: number[] | undefined,
): FanChartSeries {
  const ages = byYear.map((y) => y.age.client);

  // Dataset array order is load-bearing: the "Above average" dataset uses
  // fill: "+1", which tells chart.js to fill the area between this dataset's
  // line and the NEXT dataset's line. Placing "Below average (20th)" right
  // after it creates the p20↔p80 band.
  const datasets: FanChartDataset[] = [
    {
      label: "Above average (80th)",
      data: byYear.map((y) => y.balance.p80),
      borderColor: LINE_P80,
      backgroundColor: BAND_FILL,
      borderWidth: 1.5,
      pointRadius: 0,
      fill: "+1",
      tension: 0.25,
      order: 3,
    },
    {
      label: "Below average (20th)",
      data: byYear.map((y) => y.balance.p20),
      borderColor: LINE_P20,
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 3,
    },
    {
      label: "Median",
      data: byYear.map((y) => y.balance.p50),
      borderColor: LINE_P50,
      borderWidth: 2.5,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 2,
    },
  ];

  if (deterministic && deterministic.length === byYear.length) {
    datasets.push({
      label: "Cash-flow projection",
      data: deterministic,
      borderColor: LINE_DETERMINISTIC,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 1,
    });
  }

  return { ages, datasets };
}
