"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { colors, colorsLight, data as brandData, dataLight as brandDataLight } from "@/brand";
import {
  distributionChartSeries,
  MIN_LINE_PER_MONTH,
  rankDistributionAccounts,
  usesCashCushion,
  type DistributionMonth,
  type DistributionRow,
} from "@/lib/solver/monthly-distributions";
import { CASH_CUSHION_NOTE, money } from "@/lib/solver/distribution-card-lines";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

const fmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const LABEL = {
  income: "Income",
  other: "Other accounts",
  cash: "Cash cushion",
  need: "Spending need",
} as const;

/** Printed under the chart. */
function distributionsLegendNote(year: number): string {
  return `Each bar is one month of ${year}. The part above the dashed line pays taxes and anything else listed under Total from accounts; the card below shows the average month.`;
}

/**
 * Account colours, in a FIXED order: the largest account is always `blue`, the
 * next `yellow`, `sky`, `green`, so a colour means the same thing across years
 * and toggles. Income is the neutral grey.
 *
 * "Other accounts" is a routine roll-up, so it is a SECOND NEUTRAL, never a
 * semantic hue: not red (critical elsewhere in this feature) and not orange,
 * teal or violet (the panel's taxes, spending and goals borders). The only
 * neutral that is visibly apart from Income's grey and clears the separation
 * floor against every bar in both themes is a dark slate: `hair2` on dark
 * (34.9 at worst) and `ink2` on light (25.9). The nearest alternatives fail:
 * dark `ink2` 19.4, `ink3` 4.8; light `ink3` 18.1. Dark `ink` clears (30.3) but
 * is near-white and would swallow the dashed need line drawn in the same ink.
 *
 * The cash cushion is the brand indigo (`secondary`): no other part of this
 * view uses it, and it clears the floor against every bar in both themes
 * (31.7 dark, 41.7 light). The data hues all fail somewhere — pink against
 * green 11.8, teal against grey 7.9 — except red, which means "critical" here.
 * It is also the only bar that can sit below the zero line, which carries it
 * on a greyscale print.
 */
const ACCOUNT_KEYS = ["blue", "yellow", "sky", "green"] as const;

const otherAccountsColor = (theme: "dark" | "light") =>
  theme === "light" ? colorsLight.ink2 : colors.hair2;

const cashCushionColor = (theme: "dark" | "light") =>
  theme === "light" ? colorsLight.secondary : colors.secondary;

const palette = (theme: "dark" | "light") => (theme === "light" ? brandDataLight : brandData);

/**
 * Pure dataset builder: the twelve months of one year. The bars stack to the
 * month's income plus what the accounts send, and the dashed Spending need
 * line sits across them: bar above the line pays taxes and the other parts.
 * Set-aside goal money is never a dataset.
 *
 * `rows` is the whole plan, read only for the account ranking, so an account
 * keeps its colour (and its table column) whichever year is shown.
 */
export function buildDistributionsChartData(
  rows: DistributionRow[],
  months: DistributionMonth[],
  theme: "light" | "dark",
): ChartData<"bar" | "line"> {
  const p = palette(theme);
  const series = distributionChartSeries(months, rankDistributionAccounts(rows));

  const bar = (label: string, color: string, values: number[]) => ({
    type: "bar" as const,
    label,
    data: values,
    backgroundColor: color,
    stack: "sources",
    order: 1,
  });

  return {
    labels: months.map((m) => m.label.slice(0, 3)),
    datasets: [
      bar(LABEL.income, p.grey, series.income),
      ...series.accounts.map((a) => bar(a.name, p[ACCOUNT_KEYS[a.rank]], a.values)),
      ...(series.other ? [bar(LABEL.other, otherAccountsColor(theme), series.other)] : []),
      ...(series.cash ? [bar(LABEL.cash, cashCushionColor(theme), series.cash)] : []),
      {
        type: "line" as const,
        label: LABEL.need,
        data: series.need,
        borderColor: chartChrome(theme).title,
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 4],
        stepped: "middle" as const,
        pointRadius: 0,
        fill: false,
        order: 0,
      },
    ],
  };
}

/** One tooltip row. No "/mo": each figure is what lands in that month. The
 *  cash cushion says which way the money went. */
export function distributionTooltipLabel(label: string, value: number): string {
  if (label === LABEL.cash) {
    return value < 0
      ? `Into cash cushion: ${money(-value)}`
      : `From cash cushion: ${money(value)}`;
  }
  return `${label}: ${money(value)}`;
}

interface Props {
  /** Every plan year, for the account ranking. */
  rows: DistributionRow[];
  /** The twelve months of `year`. */
  months: DistributionMonth[];
  year: number;
}

export function SolverMonthlyDistributionsChart({ rows, months, year }: Props) {
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  const data = useMemo(
    () => buildDistributionsChartData(rows, months, theme),
    [rows, months, theme],
  );

  return (
    <div>
      <div className="h-72">
        <Chart
          type="bar"
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            scales: {
              x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
              y: {
                stacked: true,
                ticks: { color: chrome.tick, callback: (v) => fmtCompact.format(Number(v)) },
                grid: { color: chrome.grid },
              },
            },
            plugins: {
              legend: { labels: { color: chrome.legend } },
              tooltip: {
                backgroundColor: chrome.tooltipBg,
                titleColor: chrome.tooltipTitle,
                bodyColor: chrome.tooltipBody,
                filter: (item) => Math.abs(Number(item.parsed.y)) >= MIN_LINE_PER_MONTH,
                callbacks: {
                  title: (items) => `${months[items[0]?.dataIndex ?? 0]?.label ?? ""} ${year}`,
                  label: (ctx) => distributionTooltipLabel(ctx.dataset.label ?? "", Number(ctx.parsed.y)),
                  afterBody: (items) => {
                    const m = months[items[0]?.dataIndex ?? -1];
                    return m && m.taxes >= MIN_LINE_PER_MONTH ? [`Taxes: ${money(m.taxes)}`] : [];
                  },
                },
              },
            },
          }}
        />
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">{distributionsLegendNote(year)}</p>
      {usesCashCushion(months) ? (
        <p className="mt-1 text-[11.5px] text-ink-3">{CASH_CUSHION_NOTE}</p>
      ) : null}
    </div>
  );
}
