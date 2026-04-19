import type { MonteCarloSummary } from "@/engine";

export interface FanChartDataset {
  label: string;
  data: number[];
  borderColor?: string;
  borderWidth?: number;
  borderDash?: number[];
  pointRadius?: number;
  fill: false;
  tension?: number;
  order?: number;
}

export interface FanChartSeries {
  ages: number[];
  datasets: FanChartDataset[];
}

const COLOR_P80 = "rgb(52, 211, 153)";            // emerald-400 — above-average outcome
const COLOR_P50 = "rgb(110, 231, 183)";           // emerald-300 — median
const COLOR_P20 = "rgb(251, 113, 133)";           // rose-400 — below-average outcome
const COLOR_DETERMINISTIC = "rgb(148, 163, 184)"; // slate-400 — fixed-rate cash-flow projection

// Log-scale safety: clamp to $1 so chart.js's logarithmic y-axis can plot
// failed-trial balances that would otherwise hit 0 or go negative.
const clampPositive = (v: number) => Math.max(1, v);

export function buildFanChartSeries(
  byYear: MonteCarloSummary["byYear"],
  deterministic: number[] | undefined,
): FanChartSeries {
  const ages = byYear.map((y) => y.age.client);

  const datasets: FanChartDataset[] = [
    {
      label: "Above average (80th)",
      data: byYear.map((y) => clampPositive(y.balance.p80)),
      borderColor: COLOR_P80,
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 3,
    },
    {
      label: "Median",
      data: byYear.map((y) => clampPositive(y.balance.p50)),
      borderColor: COLOR_P50,
      borderWidth: 2.5,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 1,
    },
    {
      label: "Below average (20th)",
      data: byYear.map((y) => clampPositive(y.balance.p20)),
      borderColor: COLOR_P20,
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 3,
    },
  ];

  if (deterministic && deterministic.length === byYear.length) {
    datasets.push({
      label: "Cash-flow projection",
      data: deterministic.map(clampPositive),
      borderColor: COLOR_DETERMINISTIC,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 2,
    });
  }

  return { ages, datasets };
}
