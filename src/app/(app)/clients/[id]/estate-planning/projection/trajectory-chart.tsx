"use client";

/**
 * TrajectoryChart — hand-rolled SVG stacked bar chart comparing two projection
 * trajectories ("Plan 2" vs "Plan 1") year-by-year.
 *
 * Each year is a stacked bar:
 *   - Floor (blue, --color-accent) = min(Plan 1, Plan 2) — the value common to
 *     both plans.
 *   - Cap = |Plan 2 − Plan 1| stacked on top, colored:
 *       green (--color-good) when Plan 2 > Plan 1 → Plan 2's gain
 *       gray  (--color-ink-3) when Plan 1 > Plan 2 → wealth Plan 2 misses
 *     The bar's total height is therefore max(Plan 1, Plan 2).
 *
 * Death-year dashed verticals, the current-year scrubber line, hover crosshair,
 * and tooltip behave as before. Color tokens come from `src/app/globals.css`
 * (`@theme inline {}`) — modern browsers resolve CSS custom properties in SVG
 * presentation attributes.
 */

import { useMemo, useState } from "react";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { deriveChartSeries } from "./lib/derive-chart-series";

interface Props {
  leftTree: ClientData;
  leftResult: ProjectionResult;
  rightTree: ClientData;
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
  leftTree,
  leftResult,
  rightTree,
  rightResult,
  scrubberYear,
}: Props) {
  const series = useMemo(
    () => deriveChartSeries({ leftTree, rightTree, rightResult, leftResult }),
    [leftTree, rightTree, rightResult, leftResult],
  );

  const xs = series.right.map((p) => p[0]);
  const xMin = xs.length > 0 ? Math.min(...xs) : 0;
  const xMax = xs.length > 0 ? Math.max(...xs) : 0;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const plotBottom = H - PAD_B;

  const slotW = xs.length > 0 ? plotW / xs.length : plotW;
  const barW = Math.max(1, slotW * 0.7);

  const slotCenter = (i: number) => PAD_L + (i + 0.5) * slotW;
  const xForYear = (year: number) => slotCenter(year - xMin);

  const yScale = (v: number) =>
    series.yMax === 0 ? plotBottom : plotBottom - (v / series.yMax) * plotH;

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
    const idx = Math.min(
      xs.length - 1,
      Math.max(0, Math.floor((local.x - PAD_L) / slotW)),
    );
    setHoverYear(xs[idx]);
  };
  const handlePointerLeave = () => setHoverYear(null);

  const hoverIdx = hoverYear !== null ? xs.indexOf(hoverYear) : -1;
  const hoverRight = hoverIdx >= 0 ? series.right[hoverIdx]?.[1] ?? null : null;
  const hoverLeft = hoverIdx >= 0 ? series.left[hoverIdx]?.[1] ?? null : null;
  const showHover =
    hoverYear !== null && hoverRight !== null && hoverLeft !== null;
  const hoverCenter = hoverYear !== null ? xForYear(hoverYear) : 0;
  const flipTooltip = hoverCenter + TOOLTIP_W + TOOLTIP_GAP > W - PAD_R;
  const tooltipX = flipTooltip
    ? Math.max(PAD_L, hoverCenter - TOOLTIP_W - TOOLTIP_GAP)
    : hoverCenter + TOOLTIP_GAP;
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
          Plan 2 vs Plan 1 over time. Each bar&rsquo;s blue floor is the value
          common to both plans; the green cap shows where Plan 2 leaves more
          on the table, the gray cap shows where Plan 1 is ahead.
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
                className="tabular-nums"
              >
                ${((series.yMax * f) / 1_000_000).toFixed(0)}M
              </text>
            </g>
          );
        })}

        {/* stacked bars: floor (blue) + delta cap (green/gray) */}
        {xs.map((year, i) => {
          const right = series.right[i]?.[1] ?? 0;
          const left = series.left[i]?.[1] ?? 0;
          const floor = Math.min(left, right);
          const top = Math.max(left, right);
          const plan2Ahead = right >= left;
          const x = slotCenter(i) - barW / 2;

          const yFloor = yScale(floor);
          const yTop = yScale(top);
          const floorH = Math.max(0, plotBottom - yFloor);
          const capH = Math.max(0, yFloor - yTop);

          return (
            <g key={year} data-year={year}>
              {floorH > 0 && (
                <rect
                  x={x}
                  y={yFloor}
                  width={barW}
                  height={floorH}
                  fill="var(--color-accent)"
                  fillOpacity={0.85}
                />
              )}
              {capH > 0 && (
                <rect
                  x={x}
                  y={yTop}
                  width={barW}
                  height={capH}
                  fill={plan2Ahead ? "#059669" : "var(--color-ink-3)"}
                  fillOpacity={plan2Ahead ? 0.9 : 0.55}
                  data-cap={plan2Ahead ? "gain" : "loss"}
                />
              )}
            </g>
          );
        })}

        {/* death-year guides */}
        {series.firstDeathYear !== undefined && (
          <line
            x1={xForYear(series.firstDeathYear)}
            y1={PAD_T}
            x2={xForYear(series.firstDeathYear)}
            y2={plotBottom}
            stroke="var(--color-tax)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}
        {series.secondDeathYear !== undefined && (
          <line
            x1={xForYear(series.secondDeathYear)}
            y1={PAD_T}
            x2={xForYear(series.secondDeathYear)}
            y2={plotBottom}
            stroke="var(--color-crit)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        )}

        {/* current-year scrubber line */}
        <line
          data-current-year=""
          x1={xForYear(scrubberYear)}
          y1={PAD_T}
          x2={xForYear(scrubberYear)}
          y2={plotBottom}
          stroke="var(--color-accent)"
          strokeWidth={1.5}
        />

        {/* x-axis tick labels (every 10 years) */}
        {tickYears(xMin, xMax).map((y) => (
          <text
            key={y}
            x={xForYear(y)}
            y={H - 12}
            fontSize={10}
            textAnchor="middle"
            fill="var(--color-ink-3)"
            className="tabular-nums"
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
          width={Math.max(0, plotW)}
          height={Math.max(0, plotH)}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        />

        {/* hover crosshair + tooltip */}
        {showHover && (
          <g pointerEvents="none">
            <rect
              x={slotCenter(hoverIdx) - barW / 2 - 1}
              y={PAD_T}
              width={barW + 2}
              height={plotH}
              fill="var(--color-ink)"
              fillOpacity={0.04}
              stroke="var(--color-ink-2)"
              strokeOpacity={0.4}
              strokeWidth={1}
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
                className="tabular-nums"
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
                className="tabular-nums"
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
                className="tabular-nums"
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
            className="inline-block h-2 w-3 rounded-sm bg-[var(--color-accent)]/85"
          />
          Common floor
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-3 rounded-sm bg-[#059669]/90"
          />
          Plan 2 ahead
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-3 rounded-sm bg-[var(--color-ink-3)]/55"
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
