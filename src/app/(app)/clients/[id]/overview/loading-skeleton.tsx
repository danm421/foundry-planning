import { LoadingLabel, SkeletonCard, SkeletonChart, SkeletonKpi, SkeletonTable } from "@/components/skeleton";

export default function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--gap-grid)]" aria-busy="true">
      <LoadingLabel>Loading client overview…</LoadingLabel>

      <div className="grid grid-cols-2 gap-[var(--gap-grid)] md:grid-cols-3">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <SkeletonChart />
        <SkeletonChart />
      </div>

      <div className="grid grid-cols-1 gap-[var(--gap-grid)] md:grid-cols-2">
        <SkeletonCard>
          <SkeletonTable rows={4} columns={3} />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonTable rows={4} columns={3} />
        </SkeletonCard>
      </div>

      <SkeletonCard>
        <SkeletonTable rows={5} columns={4} />
      </SkeletonCard>
    </div>
  );
}
