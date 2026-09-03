"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartType,
  type Plugin,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { BracketTier } from "@/lib/tax/types";
import { buildTaxBracketRows, type TaxBracketRow } from "@/lib/tax/bracket";
import { colors, colorsLight } from "@/brand";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";

// Title registered here on purpose: the income-tax page mounts this chart
// alone, so it can't rely on a sibling chart having registered it.
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const pctLabel = (rate: number) => `${Math.round(rate * 100)}%`;

// ---------------- Model ----------------

export interface BracketFillYear {
  year: number;
  /** Income tax base that did not come from a Roth conversion. Never negative. */
  otherIncome: number;
  /** The taxable part of the year's Roth conversions, capped at the base so
   *  the two slices always stack to exactly the income tax base. */
  conversion: number;
  /** The filing-status-resolved ladder the engine applied this year, in that
   *  year's dollars — so the bands rise with indexing and halve at a first death. */
  tiers: BracketTier[];
  /** The matching Tax Bracket table row: bracket, room used, room left, AMT. */
  row: TaxBracketRow;
}

export interface BracketFillModel {
  years: BracketFillYear[];
  /** Every distinct bracket rate seen across the projection, ascending.
   *  A tier's position here picks its band wash, so 22% is the same shade
   *  in every year even after the ladder changes. */
  rates: number[];
  /** Y-axis ceiling: a round number just above the tallest filled tier's top,
   *  so the room left in the bracket is visible without squashing the bars. */
  yMax: number;
}

const CEILING_HEADROOM = 1.08;
const TOP_TIER_HEADROOM = 1.15;

/** Round up to a tidy axis ceiling: quarter steps of the magnitude at
 *  $100k and above (…, 225k, 250k, …), half steps below it. */
function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  const step = magnitude >= 100_000 ? magnitude / 4 : magnitude / 2;
  return Math.ceil(v / step) * step;
}

export function buildBracketFillModel(years: ProjectionYear[]): BracketFillModel {
  const byYear = new Map(years.map((y) => [y.year, y]));
  const rates = new Set<number>();
  const out: BracketFillYear[] = [];
  let ceiling = 0;

  for (const row of buildTaxBracketRows(years)) {
    const tiers = byYear.get(row.year)?.taxResult?.diag.incomeBracketsForFiling ?? [];
    for (const t of tiers) rates.add(t.rate);

    const base = Math.max(0, row.incomeTaxBase);
    const conversion = Math.min(base, Math.max(0, row.conversionTaxable));

    // `row.marginalRate` is the filled tier's rate (see pickFilledTier).
    const filledTop = tiers.find((t) => t.rate === row.marginalRate)?.to ?? null;
    ceiling = Math.max(
      ceiling,
      filledTop == null ? base * TOP_TIER_HEADROOM : filledTop * CEILING_HEADROOM,
    );

    out.push({ year: row.year, otherIncome: base - conversion, conversion, tiers, row });
  }

  return {
    years: out,
    rates: [...rates].sort((a, b) => a - b),
    yMax: niceCeil(ceiling),
  };
}

// ---------------- Bracket bands plugin ----------------

interface BracketBandsOptions {
  years: BracketFillYear[];
  rates: number[];
  yMax: number;
  /** Hex the band washes are mixed from (ink, at rising alpha per rate). */
  wash: string;
  /** Hairline drawn along each bracket ceiling. */
  line: string;
  /** Ink for the rate labels in the right margin. */
  label: string;
}

declare module "chart.js" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    bracketBands?: BracketBandsOptions;
  }
}

// Translucent fill from a #rrggbb hex — Chart.js paints to canvas, which can't
// read CSS vars or color-mix().
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Lowest bracket is a whisper; each step up is a shade heavier. Sequential
 *  (one hue, light→dark) because bracket rate is a magnitude, not an identity.
 *  Kept faint on purpose: the ceilings carry the information, the wash only
 *  says which band a bar is standing in. */
const washAlpha = (rank: number) => 0.02 + 0.022 * Math.max(0, rank);

/** Room kept clear to the right of the plot for the rate labels. */
const LABEL_GUTTER_PX = 36;
const MIN_LABELED_BAND_PX = 14;

/** The vertical extent of one tier on the canvas, clipped to the axis ceiling;
 *  null when the tier starts above it. */
function tierSpan(
  tier: BracketTier,
  yMax: number,
  y: { getPixelForValue(v: number): number },
): { top: number; bottom: number; capped: boolean } | null {
  if (tier.from >= yMax) return null;
  const capped = tier.to != null && tier.to < yMax;
  return {
    top: y.getPixelForValue(Math.min(tier.to ?? yMax, yMax)),
    bottom: y.getPixelForValue(tier.from),
    capped,
  };
}

/** Paints each year's bracket ladder behind its bar — a wash per tier and a
 *  hairline at every ceiling — then, over the bars, labels the rates in the
 *  right gutter against the final year's ladder. Drawn per year rather than
 *  as one set of horizontal bands so the ceilings step up with indexing and
 *  drop when the filing status flips. */
const bracketBands: Plugin<"bar"> = {
  id: "bracketBands",
  beforeDatasetsDraw(chart, _args, opts) {
    const o = opts as unknown as BracketBandsOptions | undefined;
    if (!o || o.years.length === 0 || o.yMax <= 0) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    const y = scales.y;
    const n = o.years.length;
    const half =
      n > 1
        ? (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2
        : (chartArea.right - chartArea.left) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top,
    );
    ctx.clip();

    o.years.forEach((yr, i) => {
      const x0 = x.getPixelForValue(i) - half;
      const w = half * 2;
      for (const tier of yr.tiers) {
        const span = tierSpan(tier, o.yMax, y);
        if (!span) continue;
        ctx.fillStyle = withAlpha(o.wash, washAlpha(o.rates.indexOf(tier.rate)));
        ctx.fillRect(x0, span.top, w, span.bottom - span.top);
        if (span.capped) {
          ctx.strokeStyle = o.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0, span.top + 0.5);
          ctx.lineTo(x0 + w, span.top + 0.5);
          ctx.stroke();
        }
      }
    });
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, opts) {
    const o = opts as unknown as BracketBandsOptions | undefined;
    if (!o || o.years.length === 0 || o.yMax <= 0) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.fillStyle = o.label;
    ctx.font = "11px 'B612 Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const tier of o.years[o.years.length - 1].tiers) {
      const span = tierSpan(tier, o.yMax, scales.y);
      if (!span || span.bottom - span.top < MIN_LABELED_BAND_PX) continue;
      ctx.fillText(pctLabel(tier.rate), chartArea.right + 6, (span.top + span.bottom) / 2);
    }
    ctx.restore();
  },
};

// ---------------- Tooltip copy ----------------

function fmtAges(client: number, spouse: number | null): string {
  return spouse == null ? `${client}` : `${client}/${spouse}`;
}

/** The bracket line under the two slices. Mirrors the table's columns —
 *  and, like the table, refuses to quote bracket room in an AMT year. */
function bracketFooter(row: TaxBracketRow): string[] {
  const bracket = pctLabel(row.marginalRate);
  const into = `${fmt.format(row.intoBracket)} in`;
  if (row.amtApplies) {
    const actual = row.nextDollarRate == null ? "the AMT rate" : pctLabel(row.nextDollarRate);
    return [`${bracket} bracket · ${into}`, `AMT applies: the next dollar costs ${actual}, not ${bracket}`];
  }
  if (row.remainingInBracket == null) return [`${bracket} bracket · ${into}`];
  return [`${bracket} bracket · ${into} · ${fmt.format(row.remainingInBracket)} left`];
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

export function TaxBracketChart({ years, fillHeight = false }: TaxBracketChartProps) {
  const theme = useThemeName();
  const model = useMemo(() => buildBracketFillModel(years), [years]);
  const hasConversion = model.years.some((y) => y.conversion > 0);

  const data = useMemo(() => {
    const palette = dataPalette(theme);
    const surface = (theme === "light" ? colorsLight : colors).card;
    const bar = (label: string, color: string, values: number[]) => ({
      label,
      data: values.map((v) => Math.round(v)),
      backgroundColor: color,
      // A surface-coloured hairline ring: separates the two slices from each
      // other and the bar from the band it sits on.
      borderColor: surface,
      borderWidth: 1,
      stack: "income",
      maxBarThickness: 28,
    });
    return {
      labels: model.years.map((y) => String(y.year)),
      datasets: [
        bar("Other taxable income", palette.blue, model.years.map((y) => y.otherIncome)),
        // sky is the family's second blue — the one for a two-blue stack.
        ...(hasConversion
          ? [bar("Roth conversion", palette.sky, model.years.map((y) => y.conversion))]
          : []),
      ],
    };
  }, [model, theme, hasConversion]);

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    const tokens = theme === "light" ? colorsLight : colors;
    const yearAt = (items: { dataIndex: number }[]) => model.years[items[0]?.dataIndex ?? -1];
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      layout: { padding: { right: LABEL_GUTTER_PX } },
      plugins: {
        legend: {
          display: hasConversion,
          labels: { color: chrome.legend, boxWidth: 12, padding: 16 },
        },
        title: {
          display: true,
          text: "Income tax base vs. federal brackets",
          color: chrome.title,
          font: { size: 14 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          footerColor: chrome.tooltipBody,
          footerFont: { weight: "normal" as const },
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
        bracketBands: {
          years: model.years,
          rates: model.rates,
          yMax: model.yMax,
          wash: tokens.ink,
          line: withAlpha(tokens.ink4, 0.5),
          label: chrome.tick,
        },
      },
      scales: {
        // The bands carry the horizontal reference; gridlines on top of them
        // would just be noise.
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          max: model.yMax > 0 ? model.yMax : undefined,
          ticks: {
            color: chrome.tick,
            precision: 0,
            callback: (value: unknown) => fmt.format(Number(value)),
          },
          grid: { display: false },
        },
      },
    };
  }, [model, theme, hasConversion]);

  if (years.length === 0) return null;
  return (
    <div
      className={fillHeight ? "h-full w-full" : undefined}
      style={fillHeight ? undefined : { height: 300 }}
    >
      <Bar data={data} options={options} plugins={[bracketBands]} />
    </div>
  );
}
