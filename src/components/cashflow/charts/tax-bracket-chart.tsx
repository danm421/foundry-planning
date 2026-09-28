"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { TaxBracketRow } from "@/lib/tax/bracket";
import {
  bracketFloorSeries,
  bracketRateLabel,
  buildBracketFillModel,
} from "@/lib/tax/bracket-fill";
import { colors, colorsLight } from "@/brand";
import {
  bracketFloorColor,
  chartChrome,
  dataPalette,
  useThemeName,
} from "@/lib/chart-colors";
import { formatCompact } from "@/lib/format-compact";

// Title registered here on purpose: the income-tax page mounts this chart
// alone, so it can't rely on a sibling chart having registered it.
ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const INCOME_LABEL = "Income tax base";
const CONVERSION_LABEL = "Taxable Roth conversion";

// ---------------- Datasets ----------------

/** The two bars and the floor lines, in one shape the mixed `Chart` accepts.
 *  Colours are baked in for the theme handed to the builder; the component
 *  rebuilds on a theme toggle. */
interface BracketDataset {
  type: "bar" | "line";
  label: string;
  data: (number | null)[];
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  /** Each floor line gets a stack group of its own: on a stacked axis, lines
   *  without one are stacked together, and the 24% floor would be drawn at
   *  12% + 22% + 24%. */
  stack: string;
  order: number;
  maxBarThickness?: number;
  pointRadius?: number;
  pointHitRadius?: number;
  tension?: number;
  spanGaps?: boolean;
}

// ---------------- Tooltip copy ----------------

function fmtAges(client: number, spouse: number | null): string {
  return spouse == null ? `${client}` : `${client}/${spouse}`;
}

/** The bracket line under the two slices. Mirrors the table's columns —
 *  and, like the table, refuses to quote bracket room in an AMT year. */
function bracketFooter(row: TaxBracketRow): string[] {
  const bracket = bracketRateLabel(row.marginalRate);
  const into = `${fmt.format(row.intoBracket)} in`;
  if (row.amtApplies) {
    const actual = row.nextDollarRate == null ? "the AMT rate" : bracketRateLabel(row.nextDollarRate);
    return [`${bracket} bracket · ${into}`, `AMT applies: the next dollar costs ${actual}, not ${bracket}`];
  }
  if (row.remainingInBracket == null) return [`${bracket} bracket · ${into}`];
  return [`${bracket} bracket · ${into} · ${fmt.format(row.remainingInBracket)} left`];
}

// ---------------- Legend ----------------

interface LegendItem {
  label: string;
  color: string;
}

/** Two rows, like the marks they name: the stacked series, then the bracket
 *  floors. HTML rather than the canvas legend so the labels are real text —
 *  themed by token, selectable, and read by a screen reader. */
function ChartLegend({ series, floors }: { series: LegendItem[]; floors: LegendItem[] }) {
  return (
    <div className="mt-2 flex shrink-0 flex-col items-center gap-1 text-[11px] text-ink-2">
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
      {floors.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="text-ink-3">Bracket floors</span>
          <ul className="contents" aria-label="Bracket floors">
            {floors.map((f) => (
              <li key={f.label} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-3.5 rounded-full"
                  style={{ backgroundColor: f.color }}
                />
                <span className="tabular">{f.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------- Component ----------------

interface TaxBracketChartProps {
  years: ProjectionYear[];
  /**
   * When true, the chart fills its parent container instead of a fixed 300px
   * box. The Solver renders it inside a resizable height panel; the cash-flow
   * tax view omits this and keeps the fixed height.
   */
  fillHeight?: boolean;
}

/**
 * The income tax base, year by year, as a bar split into other income and the
 * taxable Roth conversion, drawn over one line per federal bracket floor. The
 * floors climb with indexing and drop at a first death, so the bar's height
 * against the lines is the whole story: which bracket the year fills, and how
 * much room is left before the next.
 */
export function TaxBracketChart({ years, fillHeight = false }: TaxBracketChartProps) {
  const theme = useThemeName();
  const model = useMemo(() => buildBracketFillModel(years), [years]);
  const floors = useMemo(() => bracketFloorSeries(model), [model]);
  const hasConversion = model.years.some((y) => y.conversion > 0);

  const palette = dataPalette(theme);
  const surface = (theme === "light" ? colorsLight : colors).card;

  const legend = useMemo(
    () => ({
      series: [
        { label: INCOME_LABEL, color: palette.blue },
        ...(hasConversion ? [{ label: CONVERSION_LABEL, color: palette.orange }] : []),
      ],
      floors: floors.map((f) => ({
        label: bracketRateLabel(f.rate),
        color: bracketFloorColor(f.rank, theme),
      })),
    }),
    [floors, hasConversion, palette, theme],
  );

  const data = useMemo(() => {
    const bar = (label: string, color: string, values: number[]): BracketDataset => ({
      type: "bar",
      label,
      data: values.map((v) => Math.round(v)),
      backgroundColor: color,
      // A surface-coloured hairline ring: separates the two slices from each
      // other and the bar from the floor line it crosses.
      borderColor: surface,
      borderWidth: 1,
      stack: "income",
      maxBarThickness: 28,
      order: 2,
    });
    const floor = (f: (typeof floors)[number]): BracketDataset => ({
      type: "line",
      label: `${bracketRateLabel(f.rate)} floor`,
      data: f.values.map((v) => (Number.isFinite(v) ? Math.round(v) : null)),
      backgroundColor: "transparent",
      borderColor: bracketFloorColor(f.rank, theme),
      borderWidth: 1.5,
      stack: `floor-${f.rate}`,
      order: 1,
      pointRadius: 0,
      pointHitRadius: 0,
      tension: 0,
      spanGaps: false,
    });
    return {
      labels: model.years.map((y) => String(y.year)),
      datasets: [
        bar(INCOME_LABEL, palette.blue, model.years.map((y) => y.otherIncome)),
        ...(hasConversion
          ? [bar(CONVERSION_LABEL, palette.orange, model.years.map((y) => y.conversion))]
          : []),
        ...floors.map(floor),
      ],
    };
  }, [model, floors, hasConversion, palette, surface, theme]);

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    const yearAt = (items: { dataIndex: number }[]) => model.years[items[0]?.dataIndex ?? -1];
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: "Income tax base vs. federal bracket floors",
          color: chrome.title,
          font: { size: 14 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          footerColor: chrome.tooltipBody,
          footerFont: { weight: "normal" as const },
          // The floors are reference lines, not values of the year: the footer
          // already names the bracket the year sits in and the room left in it.
          filter: (item: TooltipItem<"bar" | "line">) => item.dataset.type !== "line",
          callbacks: {
            title: (items: { dataIndex: number }[]) => {
              const yr = yearAt(items);
              return yr ? `${yr.year} · ${fmtAges(yr.row.clientAge, yr.row.spouseAge)}` : "";
            },
            label: (ctx: { dataset: { label?: string }; raw: unknown }) =>
              `${ctx.dataset.label}: ${fmt.format(Number(ctx.raw))}`,
            footer: (items: { dataIndex: number }[]) => {
              const yr = yearAt(items);
              return yr ? bracketFooter(yr.row) : "";
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: chrome.tick, maxRotation: 0, autoSkipPadding: 12 },
          grid: { display: false },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          max: model.yMax > 0 ? model.yMax : undefined,
          ticks: {
            color: chrome.tick,
            precision: 0,
            // The ceiling is a round number, not a tick: labelled, it printed
            // "$425K" on top of the "$400K" gridline below it.
            includeBounds: false,
            callback: (value: unknown) => formatCompact(Number(value)),
          },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [model, theme]);

  if (years.length === 0) return null;
  return (
    <div className={fillHeight ? "flex h-full w-full flex-col" : "flex flex-col"}>
      <div
        className={fillHeight ? "relative min-h-0 flex-1" : "relative"}
        style={fillHeight ? undefined : { height: 300 }}
      >
        <Chart type="bar" data={data} options={options} />
      </div>
      <ChartLegend series={legend.series} floors={legend.floors} />
    </div>
  );
}
