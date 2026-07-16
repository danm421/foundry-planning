import {
  SkeletonCard,
  SkeletonKpi,
  SkeletonTable,
  Skeleton,
} from "@/components/skeleton";
import { MarkLoader } from "@/components/mark-loader";
import { FanMark } from "@/components/fan-mark";

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
