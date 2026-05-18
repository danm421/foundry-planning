import {
  LoadingLabel,
  SkeletonCard,
  SkeletonChart,
  SkeletonKpi,
  SkeletonTable,
  Skeleton,
} from "@/components/skeleton";

export default function MonteCarloSkeleton() {
  return (
    <div className="p-8 space-y-6" aria-busy="true">
      <LoadingLabel>Loading Monte Carlo…</LoadingLabel>

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
