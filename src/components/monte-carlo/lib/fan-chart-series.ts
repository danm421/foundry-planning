import type { MonteCarloSummary } from "@/engine";

export interface FanChartDataset {
  label: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  borderDash?: number[];
  pointRadius?: number;
  fill: false | "-1";
  tension?: number;
  order?: number;
}

export interface FanChartSeries {
  ages: number[];
  datasets: FanChartDataset[];
}

const COLOR_OUTER_BAND = "rgba(148, 163, 184, 0.18)"; // slate-400 @ 18%
const COLOR_INNER_BAND = "rgba(52, 211, 153, 0.35)";  // emerald-400 @ 35%
const COLOR_MEDIAN = "rgb(110, 231, 183)";            // emerald-300
const COLOR_DETERMINISTIC = "rgb(148, 163, 184)";     // slate-400

export function buildFanChartSeries(
  byYear: MonteCarloSummary["byYear"],
  deterministic: number[] | undefined,
): FanChartSeries {
  const ages = byYear.map((y) => y.age.client);

  const datasets: FanChartDataset[] = [
    {
      label: "p5-baseline",
      data: byYear.map((y) => y.balance.p5),
      borderColor: "transparent",
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 6,
    },
    {
      label: "Lower Bounds",
      data: byYear.map((y) => y.balance.p95),
      borderColor: "transparent",
      backgroundColor: COLOR_OUTER_BAND,
      pointRadius: 0,
      fill: "-1",
      tension: 0.25,
      order: 5,
    },
    {
      label: "p20-baseline",
      data: byYear.map((y) => y.balance.p20),
      borderColor: "transparent",
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 4,
    },
    {
      label: "Higher Outcomes",
      data: byYear.map((y) => y.balance.p80),
      borderColor: "transparent",
      backgroundColor: COLOR_INNER_BAND,
      pointRadius: 0,
      fill: "-1",
      tension: 0.25,
      order: 3,
    },
    {
      label: "Median",
      data: byYear.map((y) => y.balance.p50),
      borderColor: COLOR_MEDIAN,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 1,
    },
  ];

  if (deterministic && deterministic.length === byYear.length) {
    datasets.push({
      label: "Cash Flow Projection",
      data: deterministic,
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
