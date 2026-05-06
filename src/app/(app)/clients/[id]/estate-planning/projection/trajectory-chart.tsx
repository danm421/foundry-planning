/**
 * TrajectoryChart — hand-rolled SVG comparing two projection trajectories
 * (right column "Plan 2" vs left column "Plan 1") over the lifespan of the
 * household.
 *
 * Design:
 *   - Two filled area paths + stroked outlines (left dimmer/thinner; right
 *     brighter/thicker as the "your plan" focus).
 *   - Dashed verticals at firstDeathYear (tax/burnt-orange) and
 *     secondDeathYear (red/crit) — guards against undefined years.
 *   - Vertical scrubber line keyed by `data-current-year` for tests.
 *   - Y-axis grid with 5 horizontal rules and `${M}M` labels.
 *   - X-axis tick labels every 10 years.
 *
 * Color tokens use plain `var(--color-X)` — modern browsers resolve CSS
 * custom properties in SVG presentation attributes. Tokens come from
 * `src/app/globals.css` (`@theme inline {}` block).
 *
 * No `"use client"` directive — purely deterministic from props. The parent
 * (ProjectionPanel) is already a client component, so this chart runs in the
 * client tree without crossing a serialization boundary.
 */

import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { deriveChartSeries } from "./lib/derive-chart-series";

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

export function TrajectoryChart({
  tree,
  leftResult,
  rightResult,
  scrubberYear,
}: Props) {
  const series = deriveChartSeries({ tree, rightResult, leftResult });
  const xs = series.right.map((p) => p[0]);
  const xMin = xs.length > 0 ? Math.min(...xs) : 0;
  const xMax = xs.length > 0 ? Math.max(...xs) : 0;
  const xRange = xMax - xMin;

  const xScale = (x: number) =>
    xRange === 0
      ? PAD_L
      : PAD_L + ((x - xMin) / xRange) * (W - PAD_L - PAD_R);
  const yScale = (y: number) =>
    series.yMax === 0
      ? H - PAD_B
      : H - PAD_B - (y / series.yMax) * (H - PAD_T - PAD_B);
  const pathFor = (s: [number, number][]) =>
    s
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p[0])} ${yScale(p[1])}`)
      .join(" ");

  const areaFor = (s: [number, number][]) =>
    s.length === 0
      ? ""
      : `${pathFor(s)} L ${xScale(xMax)} ${yScale(0)} L ${xScale(xMin)} ${yScale(0)} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Estate trajectory comparison"
      className="h-auto w-full"
    >
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

      {/* left-side (Plan 1) area + line — dimmer */}
      {series.left.length > 0 && (
        <>
          <path
            d={areaFor(series.left)}
            fill="var(--color-spouse)"
            fillOpacity={0.25}
          />
          <path
            d={pathFor(series.left)}
            stroke="var(--color-spouse)"
            strokeWidth={1.5}
            fill="none"
          />
        </>
      )}

      {/* right-side (Plan 2) area + line — brighter */}
      {series.right.length > 0 && (
        <>
          <path
            d={areaFor(series.right)}
            fill="var(--color-accent)"
            fillOpacity={0.35}
          />
          <path
            d={pathFor(series.right)}
            stroke="var(--color-accent)"
            strokeWidth={2.5}
            fill="none"
          />
        </>
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
    </svg>
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
