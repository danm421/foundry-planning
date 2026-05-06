"use client";

/**
 * TrajectoryChart — hand-rolled SVG comparing two projection trajectories
 * (right column "Plan 2" vs left column "Plan 1") over the lifespan of the
 * household.
 *
 * Design:
 *   - Two clean stroked lines: left = dashed/dim (Plan 1), right = solid/
 *     bright (Plan 2). No area fills under the curves — they obscured the
 *     delta.
 *   - A delta band fills the region *between* the two lines:
 *       green  (--color-good) where right > left  → Plan 2 ahead
 *       gray   (--color-ink-4) where left > right → Plan 2 behind
 *     Sign-changing segments are split at the linearly-interpolated zero
 *     crossing so the band edges meet cleanly.
 *   - Dashed verticals at firstDeathYear (tax/burnt-orange) and
 *     secondDeathYear (red/crit) — guards against undefined years.
 *   - Vertical scrubber line keyed by `data-current-year` for tests.
 *   - Hover crosshair + tooltip showing the year and both plan values,
 *     snapped to the nearest data year. Pointer events are captured by an
 *     invisible overlay rect over the plot area.
 *   - Y-axis grid with 5 horizontal rules and `${M}M` labels.
 *   - X-axis tick labels every 10 years.
 *   - Inline legend chips below the chart explaining the band semantics.
 *
 * Color tokens use plain `var(--color-X)` — modern browsers resolve CSS
 * custom properties in SVG presentation attributes. Tokens come from
 * `src/app/globals.css` (`@theme inline {}` block).
 */

import { useMemo, useState } from "react";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  deriveChartSeries,
  deriveDeltaBands,
  type DeltaBandPoly,
} from "./lib/derive-chart-series";

interface Props {
  tree: ClientData;
  leftResult: ProjectionResult;
  rightResult: ProjectionResult;
  scrubberYear: number;
}

const W = 1200;
const H = 220;
const PAD_L = 60;
const PAD_R = 20;
const PAD_T = 20;
const PAD_B = 32;

const TOOLTIP_W = 168;
const TOOLTIP_H = 74;
const TOOLTIP_GAP = 12;

const tooltipFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

export function TrajectoryChart({
  tree,
  leftResult,
  rightResult,
  scrubberYear,
}: Props) {
  const series = useMemo(
    () => deriveChartSeries({ tree, rightResult, leftResult }),
    [tree, rightResult, leftResult],
  );
  const bands = useMemo(
    () => deriveDeltaBands(series.left, series.right),
    [series.left, series.right],
  );

  const xs = series.right.map((p) => p[0]);
  const xMin = xs.length > 0 ? Math.min(...xs) : 0;
  const xMax = xs.length > 0 ? Math.max(...xs) : 0;
  const xRange = xMax - xMin;

  const xScale = (x: number) =>
    xRange === 0 ? PAD_L : PAD_L + ((x - xMin) / xRange) * (W - PAD_L - PAD_R);
  const yScale = (y: number) =>
    series.yMax === 0
      ? H - PAD_B
      : H - PAD_B - (y / series.yMax) * (H - PAD_T - PAD_B);
  const pathFor = (s: [number, number][]) =>
    s
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p[0])} ${yScale(p[1])}`)
      .join(" ");

  const polysToPath = (polys: DeltaBandPoly[]): string =>
    polys
      .map(({ points }) => {
        if (points.length === 0) return "";
        const cmds = points
          .map(
            ([y, v], i) => `${i === 0 ? "M" : "L"} ${xScale(y)} ${yScale(v)}`,
          )
          .join(" ");
        return `${cmds} Z`;
      })
      .filter(Boolean)
      .join(" ");

  const positivePath = polysToPath(bands.positive);
  const negativePath = polysToPath(bands.negative);

  // ---- hover interaction --------------------------------------------------

  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const handlePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg || xs.length === 0) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    if (local.x < PAD_L || local.x > W - PAD_R) {
      setHoverYear(null);
      return;
    }
    const dataX = xMin + ((local.x - PAD_L) / (W - PAD_L - PAD_R)) * xRange;
    let closest = xs[0];
    let bestDist = Math.abs(closest - dataX);
    for (const x of xs) {
      const d = Math.abs(x - dataX);
      if (d < bestDist) {
        bestDist = d;
        closest = x;
      }
    }
    setHoverYear(closest);
  };
  const handlePointerLeave = () => setHoverYear(null);

  const hoverIdx = hoverYear !== null ? xs.indexOf(hoverYear) : -1;
  const hoverRight = hoverIdx >= 0 ? series.right[hoverIdx]?.[1] ?? null : null;
  const hoverLeft = hoverIdx >= 0 ? series.left[hoverIdx]?.[1] ?? null : null;
  const showHover =
    hoverYear !== null && hoverRight !== null && hoverLeft !== null;
  const hoverX = hoverYear !== null ? xScale(hoverYear) : 0;
  const flipTooltip = hoverX + TOOLTIP_W + TOOLTIP_GAP > W - PAD_R;
  const tooltipX = flipTooltip
    ? Math.max(PAD_L, hoverX - TOOLTIP_W - TOOLTIP_GAP)
    : hoverX + TOOLTIP_GAP;
  const tooltipY = PAD_T + 6;

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Estate trajectory comparison: Plan 2 vs Plan 1"
        className="h-auto w-full"
      >
        <title>
          Plan 2 vs Plan 1 over time. Green band shows years where Plan 2
          leaves more wealth on the table; gray band shows years where Plan 1
          is ahead.
        </title>

        {/* y-axis grid + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const y = yScale(series.yMax * f);
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke="var(--color-hair)"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 6}
                y={y + 3}
                fontSize={10}
                textAnchor="end"
                fill="var(--color-ink-3)"
                className="font-mono"
              >
                ${((series.yMax * f) / 1_000_000).toFixed(0)}M
              </text>
            </g>
          );
        })}

        {/* delta band — Plan 2 behind (gray) — drawn first so green sits on top */}
        {negativePath && (
          <path
            d={negativePath}
            fill="var(--color-ink-4)"
            fillOpacity={0.45}
            stroke="none"
            aria-hidden="true"
          />
        )}

        {/* delta band — Plan 2 ahead (green) */}
        {positivePath && (
          <path
            d={positivePath}
            fill="var(--color-good)"
            fillOpacity={0.32}
            stroke="none"
            aria-hidden="true"
          />
        )}

        {/* left-side (Plan 1) line — dimmer + dashed */}
        {series.left.length > 0 && (
          <path
            d={pathFor(series.left)}
            stroke="var(--color-ink-3)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fill="none"
          />
        )}

        {/* right-side (Plan 2) line — solid bright */}
        {series.right.length > 0 && (
          <path
            d={pathFor(series.right)}
            stroke="var(--color-accent)"
            strokeWidth={2.5}
            fill="none"
          />
        )}

        {/* death-year guides */}
        {series.firstDeathYear !== undefined && (
          <line
            x1={xScale(series.firstDeathYear)}
            y1={PAD_T}
            x2={xScale(series.firstDeathYear)}
            y2={H - PAD_B}
            stroke="var(--color-tax)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        {series.secondDeathYear !== undefined && (
          <line
            x1={xScale(series.secondDeathYear)}
            y1={PAD_T}
            x2={xScale(series.secondDeathYear)}
            y2={H - PAD_B}
            stroke="var(--color-crit)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}

        {/* current-year scrubber line */}
        <line
          data-current-year=""
          x1={xScale(scrubberYear)}
          y1={PAD_T}
          x2={xScale(scrubberYear)}
          y2={H - PAD_B}
          stroke="var(--color-accent)"
          strokeWidth={1.5}
        />

        {/* x-axis tick labels (every 10 years) */}
        {tickYears(xMin, xMax).map((y) => (
          <text
            key={y}
            x={xScale(y)}
            y={H - 12}
            fontSize={10}
            textAnchor="middle"
            fill="var(--color-ink-3)"
            className="font-mono"
          >
            {y}
          </text>
        ))}

        {/* invisible capture overlay — must sit between static layers and the
            hover indicators so pointermove fires reliably without blocking the
            tooltip's own pointer-events. */}
        <rect
          data-hover-overlay=""
          x={PAD_L}
          y={PAD_T}
          width={Math.max(0, W - PAD_L - PAD_R)}
          height={Math.max(0, H - PAD_T - PAD_B)}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        />

        {/* hover crosshair + dots + tooltip */}
        {showHover && (
          <g pointerEvents="none">
            <line
              x1={hoverX}
              y1={PAD_T}
              x2={hoverX}
              y2={H - PAD_B}
              stroke="var(--color-ink-2)"
              strokeDasharray="2 3"
              strokeWidth={1}
            />
            <circle
              cx={hoverX}
              cy={yScale(hoverRight)}
              r={4}
              fill="var(--color-accent)"
              stroke="var(--color-card)"
              strokeWidth={1.5}
            />
            <circle
              cx={hoverX}
              cy={yScale(hoverLeft)}
              r={4}
              fill="var(--color-ink-3)"
              stroke="var(--color-card)"
              strokeWidth={1.5}
            />

            <g transform={`translate(${tooltipX} ${tooltipY})`}>
              <rect
                width={TOOLTIP_W}
                height={TOOLTIP_H}
                rx={6}
                fill="var(--color-card-2)"
                stroke="var(--color-hair-2)"
                strokeWidth={1}
              />
              <text
                x={10}
                y={17}
                fontSize={11}
                fill="var(--color-ink)"
                fontWeight={600}
                className="font-mono"
              >
                {hoverYear}
              </text>

              <circle cx={14} cy={36} r={3} fill="var(--color-accent)" />
              <text x={22} y={39} fontSize={11} fill="var(--color-ink-2)">
                Plan 2
              </text>
              <text
                x={TOOLTIP_W - 10}
                y={39}
                fontSize={11}
                textAnchor="end"
                fill="var(--color-ink)"
                className="font-mono"
              >
                {tooltipFmt.format(hoverRight)}
              </text>

              <circle cx={14} cy={56} r={3} fill="var(--color-ink-3)" />
              <text x={22} y={59} fontSize={11} fill="var(--color-ink-2)">
                Plan 1
              </text>
              <text
                x={TOOLTIP_W - 10}
                y={59}
                fontSize={11}
                textAnchor="end"
                fill="var(--color-ink)"
                className="font-mono"
              >
                {tooltipFmt.format(hoverLeft)}
              </text>
            </g>
          </g>
        )}
      </svg>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-[60px] text-[11px] text-ink-3">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-5 rounded-full bg-accent"
          />
          Plan 2
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-px w-5 border-t border-dashed border-ink-3"
          />
          Plan 1
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-3 rounded-sm bg-[var(--color-good)]/40"
          />
          Plan 2 ahead
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-3 rounded-sm bg-[var(--color-ink-4)]/50"
          />
          Plan 1 ahead
        </li>
      </ul>
    </div>
  );
}

function tickYears(min: number, max: number): number[] {
  const out: number[] = [];
  if (max < min) return out;
  let y = Math.ceil(min / 10) * 10;
  while (y <= max) {
    out.push(y);
    y += 10;
  }
  return out;
}
