import {
  SkeletonCard,
  SkeletonKpi,
  SkeletonTable,
  Skeleton,
} from "@/components/skeleton";
import { MarkLoader, drawStyle } from "@/components/mark-loader";

// The Monte Carlo "simulating" mark — five verdigris strokes fanning from a
// left origin dot into the probability cone, echoing the report's hero
// fan-chart. Each stroke draws itself in via the shared `.mark-draw` class,
// staggered so the median anchors first and the cone opens outward; the outer
// pairs sit fainter for depth. A soft verdigris halo breathes behind it (see
// `MarkLoader`). Under `prefers-reduced-motion` every stroke settles fully
// drawn and the halo holds steady — handled by the `.mark-*` utilities.
function FanMark() {
  const strokes = [
    { d: "M 6 17 C 24 17, 30 17, 43 17", opacity: 1, delay: "0.15s" }, // median
    { d: "M 6 17 C 22 17, 28 9, 43 9", opacity: 0.6, delay: "0.35s" }, // upper inner
    { d: "M 6 17 C 22 17, 28 25, 43 25", opacity: 0.6, delay: "0.35s" }, // lower inner
    { d: "M 6 17 C 22 17, 28 3, 43 3", opacity: 0.3, delay: "0.55s" }, // upper outer
    { d: "M 6 17 C 22 17, 28 31, 43 31", opacity: 0.3, delay: "0.55s" }, // lower outer
  ];
  return (
    <svg
      viewBox="0 0 48 34"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className="relative h-14 w-20 text-accent"
      aria-hidden
    >
      {strokes.map((s, i) => (
        <path
          key={i}
          className="mark-draw"
          pathLength={100}
          d={s.d}
          opacity={s.opacity}
          style={drawStyle("0.9s", s.delay)}
        />
      ))}
      {/* Origin dot — the common source the paths fan out from. */}
      <circle cx={6} cy={17} r={2.4} fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Loading state for BOTH Monte Carlo surfaces — the solver's MC tab and the
 * full /cashflow/monte-carlo report mount this one component. A light layout
 * skeleton previews the report's structure while the branded fan mark, standing
 * in for the hero chart, carries the wait. MC is a single server fetch with no
 * incremental progress, so the breathing mark — not a progress bar — signals
 * "working"; a role=status line announces it to screen readers.
 */
export default function MonteCarloSkeleton() {
  return (
    <div className="p-8 space-y-6" aria-busy="true">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
        {/* Main column */}
        <div className="flex flex-col gap-6 min-w-0">
          {/* Report header */}
          <Skeleton height="1.75rem" width="18rem" />

          {/* KPI band */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <SkeletonKpi />
            </div>
            <SkeletonKpi />
            <SkeletonKpi />
            <SkeletonKpi />
          </div>

          {/* Hero chart slot — the branded fan mark carries the wait. */}
          <MarkLoader
            className="min-h-[300px]"
            markBoxClassName="h-20 w-20"
            mark={<FanMark />}
            caption="Running your Monte Carlo simulation…"
            status="Running your Monte Carlo simulation. This can take a moment."
          />

          {/* Yearly breakdown */}
          <SkeletonCard>
            <SkeletonTable rows={5} columns={4} />
          </SkeletonCard>
        </div>

        {/* Sidebar column */}
        <div className="flex flex-col gap-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
