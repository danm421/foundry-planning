import {
  SkeletonCard,
  SkeletonChart,
  SkeletonKpi,
  SkeletonTable,
  Skeleton,
} from "@/components/skeleton";

export default function MonteCarloSkeleton() {
  return (
    <div className="p-8 space-y-6" aria-busy="true">
      {/* Visible "running" indicator. The skeleton alone reads as an empty or
          stuck page; a spinning pip + label makes it clear the simulation is
          actively computing. role=status + aria-live announces it to readers,
          so the prior sr-only LoadingLabel is no longer needed. */}
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span
          className="h-3 w-3 rounded-full border-2 border-hair border-t-accent motion-safe:animate-spin"
          aria-hidden="true"
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          Running Monte Carlo simulation…
        </span>
      </div>

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

          {/* Main chart */}
          <SkeletonChart />

          {/* Yearly breakdown */}
          <SkeletonCard>
            <SkeletonTable rows={6} columns={4} />
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
