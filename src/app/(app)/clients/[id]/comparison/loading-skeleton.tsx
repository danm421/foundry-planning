import { LoadingLabel, SkeletonKpi, SkeletonChart, SkeletonCard } from "@/components/skeleton";

export default function ComparisonSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--gap-grid)]" aria-busy="true">
      <LoadingLabel>Loading comparison…</LoadingLabel>

      <div className="grid grid-cols-2 gap-[var(--gap-grid)] md:grid-cols-4">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <SkeletonCard>
          <SkeletonChart />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonChart />
        </SkeletonCard>
      </div>

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <SkeletonCard>
          <SkeletonChart />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonChart />
        </SkeletonCard>
      </div>
    </div>
  );
}
