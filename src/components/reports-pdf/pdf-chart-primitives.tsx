// src/components/reports-pdf/pdf-chart-primitives.ts
//
// Shared SVG primitives for PDF chart widgets. All chart kinds in
// `components/reports-pdf/widgets/*` consume these — keeping the axis math
// and palette decisions in one place. Built on top of `@react-pdf/renderer`'s
// SVG primitives (`Svg`, `G`, `Rect`, `Line`, `Path`, `Polyline`, `Polygon`,
// `Circle`, `Text`).
//
// `makePlot` returns axis-mapping functions; primitives consume the resulting
// `Plot` object. No React state, no contexts — just plain composable
// helpers.
//
// Colors come from `REPORT_THEME` (the single source of truth at
// `lib/reports/theme.ts`). Primitives never inline brand hex values.

import type { ReactElement, ReactNode } from "react";
import {
  G,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Svg,
  Text,
} from "@react-pdf/renderer";
import { REPORT_THEME } from "@/lib/reports/theme";

// ---------- Number formatters ----------

/** Compact-dollar formatting for axis ticks and value labels.
 *  >=1e6 → "$1.2M", >=1e3 → "$340K", otherwise "$50". Negatives wrap in
 *  parens (financial convention). */
export function fmtCompactDollar(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e6) {
    s = `$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  } else if (abs >= 1e3) {
    s = `$${(abs / 1e3).toFixed(0)}K`;
  } else {
    s = `$${abs.toFixed(0)}`;
  }
  return n < 0 ? `(${s})` : s;
}

/** Percent for 0–100 input → "75%". */
export function fmtPercent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

/** Percent for 0–1 input → "75.0%". */
export function fmtPercentDecimal(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

/** Year-tick formatter — currently just `String(n)` but isolated so the
 *  axis primitive doesn't bake the assumption in. */
export function fmtYearTick(n: number): string {
  return String(n);
}

// ---------- Plot context (axis math) ----------

export type Plot = {
  /** Pixel coordinates of the chart-area inner rectangle (axes/labels live
   *  outside). */
  inner: { x: number; y: number; width: number; height: number };
  xDomain: [number, number];
  yDomain: [number, number];
  width: number;
  height: number;
  /** Map data X (e.g. year) → pixel X. */
  xScale: (value: number) => number;
  /** Map data Y → pixel Y. */
  yScale: (value: number) => number;
  /** Pixel width of one band when X is treated categorically (for bar
   *  charts). Equals `inner.width / xCount` when caller supplies it. */
  bandWidth: (xCount: number) => number;
};

export type UsePlotArgs = {
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  /** Inner-padding around the plot area. Numbers in PDF px (= points). */
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
};

/** Pure helper — not a React hook (the `use` prefix matches the spec but
 *  there's no state, just math). Returns a `Plot` with linear scales. */
export function makePlot({
  width,
  height,
  xDomain,
  yDomain,
  padding,
}: UsePlotArgs): Plot {
  const pad = {
    top: padding?.top ?? 12,
    right: padding?.right ?? 12,
    bottom: padding?.bottom ?? 22,
    left: padding?.left ?? 44,
  };
  const inner = {
    x: pad.left,
    y: pad.top,
    width: Math.max(1, width - pad.left - pad.right),
    height: Math.max(1, height - pad.top - pad.bottom),
  };
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const xSpan = x1 - x0 || 1;
  const ySpan = y1 - y0 || 1;
  const xScale = (v: number) => inner.x + ((v - x0) / xSpan) * inner.width;
  // SVG y grows downward — flip so larger data values render higher.
  const yScale = (v: number) =>
    inner.y + inner.height - ((v - y0) / ySpan) * inner.height;
  const bandWidth = (xCount: number) =>
    xCount <= 0 ? 0 : inner.width / xCount;
  return { inner, xDomain, yDomain, width, height, xScale, yScale, bandWidth };
}

// ---------- Tick generation ----------

/** Pick "nice" Y ticks for a domain. 5 ticks default — enough resolution for
 *  a quick read without crowding. */
export function niceYTicks(yDomain: [number, number], count = 5): number[] {
  const [y0, y1] = yDomain;
  if (count <= 1) return [y0, y1];
  const step = (y1 - y0) / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(y0 + step * i);
  return ticks;
}

/** Year-axis ticks. For long horizons (>20 years) prefer 5-year intervals
 *  (1995, 2000, 2005…); shorter horizons pick a 2- or 1-year cadence so
 *  a 5-year chart doesn't render two labels and a wall of white space. */
export function niceYearTicks(years: number[]): number[] {
  if (years.length === 0) return [];
  const span = years[years.length - 1] - years[0];
  let step = 1;
  if (span > 30) step = 10;
  else if (span > 20) step = 5;
  else if (span > 10) step = 2;
  const out: number[] = [];
  for (const y of years) {
    if (y % step === 0) out.push(y);
  }
  // Always include first + last so the axis reads endpoints clearly.
  if (out[0] !== years[0]) out.unshift(years[0]);
  if (out[out.length - 1] !== years[years.length - 1]) out.push(years[years.length - 1]);
  return out;
}

// ---------- Primitives ----------

const HAIR = REPORT_THEME.colors.hair;
const INK = REPORT_THEME.colors.ink;
const INK2 = REPORT_THEME.colors.ink2;
const INK3 = REPORT_THEME.colors.ink3;
const PALETTE = REPORT_THEME.chartPalette;

export function GridLines({
  plot,
  ticks,
  color = HAIR,
}: {
  plot: Plot;
  ticks?: number[];
  color?: string;
}): ReactElement {
  const ys = ticks ?? niceYTicks(plot.yDomain);
  return (
    <G>
      {ys.map((t, i) => {
        const y = plot.yScale(t);
        return (
          <Line
            key={i}
            x1={plot.inner.x}
            x2={plot.inner.x + plot.inner.width}
            y1={y}
            y2={y}
            stroke={color}
            strokeWidth={0.5}
          />
        );
      })}
    </G>
  );
}

export function AxisX({
  plot,
  years,
  ticks,
  color = INK3,
  fontSize = 7,
}: {
  plot: Plot;
  /** All years in the data — used to pick "nice" ticks if `ticks` is unset. */
  years: number[];
  ticks?: number[];
  color?: string;
  fontSize?: number;
}): ReactElement {
  const tickValues = ticks ?? niceYearTicks(years);
  const baselineY = plot.inner.y + plot.inner.height;
  return (
    <G>
      <Line
        x1={plot.inner.x}
        x2={plot.inner.x + plot.inner.width}
        y1={baselineY}
        y2={baselineY}
        stroke={HAIR}
        strokeWidth={0.5}
      />
      {tickValues.map((v) => (
        <Text
          key={v}
          x={plot.xScale(v)}
          y={baselineY + fontSize + 4}
          fill={color}
          textAnchor="middle"
          style={{ fontSize }}
        >
          {fmtYearTick(v)}
        </Text>
      ))}
    </G>
  );
}

export function AxisY({
  plot,
  ticks,
  format = fmtCompactDollar,
  color = INK3,
  fontSize = 7,
}: {
  plot: Plot;
  ticks?: number[];
  format?: (n: number) => string;
  color?: string;
  fontSize?: number;
}): ReactElement {
  const tickValues = ticks ?? niceYTicks(plot.yDomain);
  return (
    <G>
      {tickValues.map((v, i) => (
        <Text
          key={i}
          x={plot.inner.x - 4}
          y={plot.yScale(v) + fontSize / 2 - 1}
          fill={color}
          textAnchor="end"
          style={{ fontSize }}
        >
          {format(v)}
        </Text>
      ))}
    </G>
  );
}

// ---------- Bar series ----------

export type BarPoint = { x: number; value: number; label?: string };

export function BarSeries({
  plot,
  points,
  color = PALETTE[0],
  barWidth,
  showLabels = false,
  labelFormat = fmtCompactDollar,
  labelColor = INK,
  labelFontSize = 7,
}: {
  plot: Plot;
  points: BarPoint[];
  color?: string;
  /** Optional override; defaults to `bandWidth * 0.7`. */
  barWidth?: number;
  showLabels?: boolean;
  labelFormat?: (n: number) => string;
  labelColor?: string;
  labelFontSize?: number;
}): ReactElement {
  const band = plot.bandWidth(points.length);
  const w = barWidth ?? band * 0.7;
  const baseY = plot.yScale(0);
  return (
    <G>
      {points.map((p, i) => {
        const cx = plot.xScale(p.x);
        const py = plot.yScale(p.value);
        const top = Math.min(baseY, py);
        const h = Math.abs(baseY - py);
        return (
          <G key={i}>
            <Rect x={cx - w / 2} y={top} width={w} height={h} fill={color} />
            {showLabels && (
              <Text
                x={cx}
                y={top - 2}
                fill={labelColor}
                textAnchor="middle"
                style={{ fontSize: labelFontSize }}
              >
                {labelFormat(p.value)}
              </Text>
            )}
          </G>
        );
      })}
    </G>
  );
}

// Stacked bars — one stack per X. Positive series stack upward from 0;
// negative series stack downward (used by cashflow expenses).
export type StackedDataset = {
  label: string;
  color: string;
  /** Values per X (length must match `xs`). */
  values: number[];
  /** Direction of stacking. Defaults to "positive" (up from 0). */
  direction?: "positive" | "negative";
};

export function StackedBarSeries({
  plot,
  xs,
  datasets,
  barWidth,
}: {
  plot: Plot;
  xs: number[];
  datasets: StackedDataset[];
  barWidth?: number;
}): ReactElement {
  const band = plot.bandWidth(xs.length);
  const w = barWidth ?? band * 0.7;
  const posStack = xs.map(() => 0);
  const negStack = xs.map(() => 0);
  return (
    <G>
      {datasets.map((ds, di) => {
        const dir = ds.direction ?? "positive";
        return (
          <G key={di}>
            {xs.map((x, xi) => {
              const v = ds.values[xi] ?? 0;
              if (v === 0) return null;
              const cx = plot.xScale(x);
              if (dir === "positive") {
                const start = posStack[xi];
                const next = start + Math.abs(v);
                posStack[xi] = next;
                const yTop = plot.yScale(next);
                const yBot = plot.yScale(start);
                return (
                  <Rect
                    key={xi}
                    x={cx - w / 2}
                    y={yTop}
                    width={w}
                    height={Math.max(0, yBot - yTop)}
                    fill={ds.color}
                  />
                );
              } else {
                const start = negStack[xi];
                const next = start + Math.abs(v);
                negStack[xi] = next;
                const yPosTop = plot.yScale(-start);
                const yPosBot = plot.yScale(-next);
                return (
                  <Rect
                    key={xi}
                    x={cx - w / 2}
                    y={yPosTop}
                    width={w}
                    height={Math.max(0, yPosBot - yPosTop)}
                    fill={ds.color}
                  />
                );
              }
            })}
          </G>
        );
      })}
    </G>
  );
}

// ---------- Line series ----------

export function LineSeries({
  plot,
  points,
  color = PALETTE[0],
  strokeWidth = 1.5,
  strokeDasharray,
}: {
  plot: Plot;
  points: { x: number; value: number }[];
  color?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
}): ReactElement {
  const pts = points
    .map((p) => `${plot.xScale(p.x)},${plot.yScale(p.value)}`)
    .join(" ");
  return (
    <Polyline
      points={pts}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
    />
  );
}

// ---------- Area series ----------

/** Filled area between an upper line (`points`) and either the X axis
 *  (`baseValue=0`) or another series (`lowerPoints`). */
export function AreaSeries({
  plot,
  points,
  color = PALETTE[0],
  fillOpacity = 0.25,
  baseValue = 0,
  lowerPoints,
  strokeColor,
  strokeWidth = 1,
}: {
  plot: Plot;
  points: { x: number; value: number }[];
  color?: string;
  fillOpacity?: number;
  baseValue?: number;
  lowerPoints?: { x: number; value: number }[];
  strokeColor?: string;
  strokeWidth?: number;
}): ReactElement | null {
  if (points.length === 0) return null;
  const top = points.map((p) => `${plot.xScale(p.x)},${plot.yScale(p.value)}`);
  const bottom: string[] = [];
  if (lowerPoints && lowerPoints.length > 0) {
    for (let i = lowerPoints.length - 1; i >= 0; i--) {
      const p = lowerPoints[i];
      bottom.push(`${plot.xScale(p.x)},${plot.yScale(p.value)}`);
    }
  } else {
    const baseY = plot.yScale(baseValue);
    bottom.push(`${plot.xScale(points[points.length - 1].x)},${baseY}`);
    bottom.push(`${plot.xScale(points[0].x)},${baseY}`);
  }
  const polyPoints = [...top, ...bottom].join(" ");
  return (
    <G>
      <Polygon
        points={polyPoints}
        fill={color}
        fillOpacity={fillOpacity}
        stroke={strokeColor ?? "none"}
        strokeWidth={strokeColor ? strokeWidth : 0}
      />
    </G>
  );
}

// ---------- Donut series ----------

export type DonutSlice = { label: string; value: number; color: string };

/** Donut/pie chart. `centerLabel`/`centerSubLabel` render in the middle hole.
 *  `cx`/`cy` default to the SVG midpoint; pass explicit coords when laying
 *  out next to a legend. */
export function DonutSeries({
  slices,
  cx,
  cy,
  outerRadius,
  innerRadius,
  centerLabel,
  centerSubLabel,
  centerLabelColor = INK,
  centerSubColor = INK2,
}: {
  slices: DonutSlice[];
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  centerLabel?: string;
  centerSubLabel?: string;
  centerLabelColor?: string;
  centerSubColor?: string;
}): ReactElement {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  let cursor = -Math.PI / 2; // start at 12 o'clock
  const arcs: ReactElement[] = [];
  if (total > 0) {
    slices.forEach((slice, i) => {
      const v = Math.max(0, slice.value);
      if (v === 0) return;
      const sweep = (v / total) * Math.PI * 2;
      const start = cursor;
      const end = cursor + sweep;
      cursor = end;
      arcs.push(
        <Path
          key={i}
          d={donutSliceD(cx, cy, outerRadius, innerRadius, start, end)}
          fill={slice.color}
        />,
      );
    });
  } else {
    // Empty state — render a hairline ring so the layout still reads.
    arcs.push(
      <Path
        key="empty"
        d={donutSliceD(cx, cy, outerRadius, innerRadius, 0, Math.PI * 2)}
        fill={HAIR}
      />,
    );
  }
  return (
    <G>
      {arcs}
      {centerLabel && (
        <Text
          x={cx}
          y={cy + 1}
          fill={centerLabelColor}
          textAnchor="middle"
          style={{ fontSize: 12 }}
        >
          {centerLabel}
        </Text>
      )}
      {centerSubLabel && (
        <Text
          x={cx}
          y={cy + 13}
          fill={centerSubColor}
          textAnchor="middle"
          style={{ fontSize: 7 }}
        >
          {centerSubLabel}
        </Text>
      )}
    </G>
  );
}

function donutSliceD(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const cosStart = Math.cos(start);
  const sinStart = Math.sin(start);
  // Single full ring — split into two arcs to keep PDF renderer happy.
  if (Math.abs(end - start - Math.PI * 2) < 1e-6) {
    const cosHalf = -cosStart;
    const sinHalf = -sinStart;
    const startOuter = `${cx + rOuter * cosStart},${cy + rOuter * sinStart}`;
    const startInner = `${cx + rInner * cosStart},${cy + rInner * sinStart}`;
    const halfwayOuter = `${cx + rOuter * cosHalf},${cy + rOuter * sinHalf}`;
    const halfwayInner = `${cx + rInner * cosHalf},${cy + rInner * sinHalf}`;
    return [
      `M ${startOuter}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${halfwayOuter}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${startOuter}`,
      `M ${startInner}`,
      `A ${rInner} ${rInner} 0 1 0 ${halfwayInner}`,
      `A ${rInner} ${rInner} 0 1 0 ${startInner}`,
      "Z",
    ].join(" ");
  }
  const cosEnd = Math.cos(end);
  const sinEnd = Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  const sox = cx + rOuter * cosStart;
  const soy = cy + rOuter * sinStart;
  const eox = cx + rOuter * cosEnd;
  const eoy = cy + rOuter * sinEnd;
  const six = cx + rInner * cosStart;
  const siy = cy + rInner * sinStart;
  const eix = cx + rInner * cosEnd;
  const eiy = cy + rInner * sinEnd;
  return [
    `M ${sox} ${soy}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${eox} ${eoy}`,
    `L ${eix} ${eiy}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${six} ${siy}`,
    "Z",
  ].join(" ");
}

// ---------- Legend ----------

export type LegendItem = { label: string; color: string };

export function Legend({
  items,
  x,
  y,
  orientation = "horizontal",
  fontSize = 8,
  swatchSize = 7,
  gap = 6,
  itemGap = 12,
  color = INK2,
}: {
  items: LegendItem[];
  x: number;
  y: number;
  orientation?: "horizontal" | "vertical";
  fontSize?: number;
  swatchSize?: number;
  gap?: number;
  itemGap?: number;
  color?: string;
}): ReactElement {
  // Approximate label width — PDF doesn't expose font metrics in SVG context.
  // 0.55em per char is a reasonable upper bound for our 8pt sans-serif; the
  // small overshoot avoids overlap on long labels at the cost of trailing space.
  const offsets: number[] = [];
  let cursor = 0;
  for (const it of items) {
    offsets.push(cursor);
    cursor += swatchSize + gap + it.label.length * fontSize * 0.55 + itemGap;
  }
  return (
    <G>
      {items.map((it, i) => {
        if (orientation === "horizontal") {
          const ix = x + offsets[i];
          const iy = y;
          return (
            <G key={i}>
              <Rect
                x={ix}
                y={iy - swatchSize / 2}
                width={swatchSize}
                height={swatchSize}
                fill={it.color}
              />
              <Text
                x={ix + swatchSize + gap}
                y={iy + fontSize / 2 - 1}
                fill={color}
                style={{ fontSize }}
              >
                {it.label}
              </Text>
            </G>
          );
        }
        const iy = y + i * (fontSize + 6);
        return (
          <G key={i}>
            <Rect
              x={x}
              y={iy - swatchSize / 2 + fontSize / 2}
              width={swatchSize}
              height={swatchSize}
              fill={it.color}
            />
            <Text
              x={x + swatchSize + gap}
              y={iy + fontSize / 2 + 2}
              fill={color}
              style={{ fontSize }}
            >
              {it.label}
            </Text>
          </G>
        );
      })}
    </G>
  );
}

// ---------- Value labels ----------

export function ValueLabel({
  x,
  y,
  text,
  color = INK,
  fontSize = 8,
  textAnchor = "middle",
}: {
  x: number;
  y: number;
  text: string;
  color?: string;
  fontSize?: number;
  textAnchor?: "start" | "middle" | "end";
}): ReactElement {
  return (
    <Text x={x} y={y} fill={color} textAnchor={textAnchor} style={{ fontSize }}>
      {text}
    </Text>
  );
}

// ---------- Re-exports ----------

export { Svg, G, Rect, Line, Path, Polyline, Polygon, Text };

// (Non-primitive helpers can be re-imported for ad-hoc chart composition
// in tests. `ReactNode` re-export keeps consumers from importing react
// just for the type.)
export type { ReactNode };
