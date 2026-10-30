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
  hasOtherAccounts,
  rankDistributionAccounts,
  type DistributionRow,
} from "@/lib/solver/monthly-distributions";

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
const fmtFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** The selected year's outline, matching `SolverMonthlyCashFlowChart`. */
const SELECTED_BORDER_WIDTH = 2;

/** Under fifty cents a month a part would print as "$0" (the panel's cut-off). */
const MIN_PART = 0.5;

const LABEL = {
  income: "Income",
  other: "Other accounts",
  need: "Spending need",
} as const;

/** Printed under the chart. Verbatim. */
export const DISTRIBUTIONS_LEGEND_NOTE =
  "The part of each bar above the dashed line pays taxes and anything else listed under Total from accounts.";

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
 */
const ACCOUNT_KEYS = ["blue", "yellow", "sky", "green"] as const;

const otherAccountsColor = (theme: "dark" | "light") =>
  theme === "light" ? colorsLight.ink2 : colors.hair2;

const palette = (theme: "dark" | "light") => (theme === "light" ? brandDataLight : brandData);

/** Same wording as the panel's "made of" line, so chart and card agree. */
const PART_LABELS: { key: keyof DistributionRow["fromAccounts"]["parts"]; label: string }[] = [
  { key: "spending", label: "spending" },
  { key: "taxes", label: "taxes" },
  { key: "goalShortfall", label: "goal shortfall" },
  { key: "surplusSpent", label: "extra spending of surplus" },
  { key: "absorbedExtra", label: "extra spending (whatever's left)" },
  { key: "keptOrReinvested", label: "more than needed — reinvested / kept in cash" },
];

/**
 * Pure dataset builder. The bars stack to income + total from accounts, and the
 * dashed Spending need line sits across them: bar above the line pays taxes and
 * the other parts. Set-aside goal money is never a dataset.
 */
export function buildDistributionsChartData(
  rows: DistributionRow[],
  theme: "light" | "dark",
): ChartData<"bar" | "line"> {
  const p = palette(theme);
  const ranked = rankDistributionAccounts(rows);
  const rankedIds = new Set(ranked.map((a) => a.accountId));
  const showOther = hasOtherAccounts(rows, ranked);

  const bar = (label: string, color: string, values: number[]) => ({
    type: "bar" as const,
    label,
    data: values,
    backgroundColor: color,
    stack: "sources",
    order: 1,
  });

  const otherOf = (r: DistributionRow) =>
    r.fromAccounts.total -
    r.fromAccounts.accounts.reduce((s, a) => (rankedIds.has(a.accountId) ? s + a.amount : s), 0);

  return {
    labels: rows.map((r) => String(r.year)),
    datasets: [
      bar(
        LABEL.income,
        p.grey,
        rows.map((r) => r.income.total),
      ),
      ...ranked.map((a, i) =>
        bar(
          a.name,
          p[ACCOUNT_KEYS[i]],
          rows.map((r) => r.fromAccounts.accounts.find((l) => l.accountId === a.accountId)?.amount ?? 0),
        ),
      ),
      ...(showOther ? [bar(LABEL.other, otherAccountsColor(theme), rows.map((r) => Math.max(0, otherOf(r))))] : []),
      {
        type: "line" as const,
        label: LABEL.need,
        data: rows.map((r) => r.need.total),
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

/** Year-index helpers. Local on purpose: the Cash flow chart's are typed to its
 *  own row and a month-mode flag, and are not widened for this chart. */
export function clickedDistributionYear(rows: DistributionRow[], index: number): number | null {
  return rows[index]?.year ?? null;
}

export function selectedDistributionIndex(
  rows: DistributionRow[],
  selectedYear: number | null | undefined,
): number {
  if (selectedYear == null) return -1;
  return rows.findIndex((r) => r.year === selectedYear);
}

/** Outline the selected year's column rather than dimming the rest. */
function withSelectedOutline(
  data: ChartData<"bar" | "line">,
  selectedIndex: number,
  outlineColor: string,
): ChartData<"bar" | "line"> {
  if (selectedIndex < 0) return data;
  return {
    ...data,
    datasets: data.datasets.map((ds) =>
      ds.type !== "bar"
        ? ds
        : {
            ...ds,
            borderColor: outlineColor,
            borderWidth: (data.labels ?? []).map((_, i) =>
              i === selectedIndex ? SELECTED_BORDER_WIDTH : 0,
            ),
            borderSkipped: false,
          },
    ),
  };
}

/** The tooltip lines after the per-series rows: taxes, then every non-zero
 *  part of "Total from accounts". */
export function distributionTooltipExtras(r: DistributionRow): string[] {
  const fmt = (v: number) => `${fmtFull.format(v)}/mo`;
  return [
    ...(Math.abs(r.taxes) >= MIN_PART ? [`Taxes: ${fmt(r.taxes)}`] : []),
    ...PART_LABELS.filter(({ key }) => Math.abs(r.fromAccounts.parts[key]) >= MIN_PART).map(
      ({ key, label }) => `From accounts, ${label}: ${fmt(r.fromAccounts.parts[key])}`,
    ),
  ];
}

interface Props {
  rows: DistributionRow[];
  selectedYear: number | null;
  onYearClick: (year: number) => void;
}

export function SolverMonthlyDistributionsChart({ rows, selectedYear, onYearClick }: Props) {
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  const data = useMemo(() => buildDistributionsChartData(rows, theme), [rows, theme]);
  const selectedIndex = useMemo(
    () => selectedDistributionIndex(rows, selectedYear),
    [rows, selectedYear],
  );
  const styledData = useMemo(
    () => withSelectedOutline(data, selectedIndex, chrome.title),
    [data, selectedIndex, chrome.title],
  );

  return (
    <div>
      <div className="h-72">
        <Chart
          type="bar"
          data={styledData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            onClick: (_event, elements: Array<{ index: number }>) => {
              if (elements.length === 0) return;
              const year = clickedDistributionYear(rows, elements[0].index);
              if (year != null) onYearClick(year);
            },
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
                filter: (item) => Number(item.parsed.y) !== 0,
                callbacks: {
                  label: (ctx) =>
                    `${ctx.dataset.label ?? ""}: ${fmtFull.format(Number(ctx.parsed.y))}/mo`,
                  afterBody: (items) => {
                    const r = rows[items[0]?.dataIndex ?? -1];
                    return r ? distributionTooltipExtras(r) : [];
                  },
                },
              },
            },
          }}
        />
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">{DISTRIBUTIONS_LEGEND_NOTE}</p>
    </div>
  );
}
