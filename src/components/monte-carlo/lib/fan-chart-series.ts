import type { MonteCarloSummary } from "@/engine";

export interface FanChartDataset {
  label: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  borderDash?: number[];
  pointRadius?: number;
  fill: false | "origin";
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

const FILL_P80 = "rgba(52, 211, 153, 0.12)";
const FILL_P50 = "rgba(110, 231, 183, 0.20)";
const FILL_P20 = "rgba(251, 113, 133, 0.22)";

export function buildFanChartSeries(
  byYear: MonteCarloSummary["byYear"],
  deterministic: number[] | undefined,
): FanChartSeries {
  const ages = byYear.map((y) => y.age.client);

  const datasets: FanChartDataset[] = [
    {
      label: "Above average (80th)",
      data: byYear.map((y) => y.balance.p80),
      borderColor: LINE_P80,
      backgroundColor: FILL_P80,
      borderWidth: 1.5,
      pointRadius: 0,
      fill: "origin",
      tension: 0.25,
      order: 5,
    },
    {
      label: "Median",
      data: byYear.map((y) => y.balance.p50),
      borderColor: LINE_P50,
      backgroundColor: FILL_P50,
      borderWidth: 2.5,
      pointRadius: 0,
      fill: "origin",
      tension: 0.25,
      order: 4,
    },
    {
      label: "Below average (20th)",
      data: byYear.map((y) => y.balance.p20),
      borderColor: LINE_P20,
      backgroundColor: FILL_P20,
      borderWidth: 1.5,
      pointRadius: 0,
      fill: "origin",
      tension: 0.25,
      order: 3,
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
