import {
  LoadingLabel,
  SkeletonCard,
  SkeletonChart,
  SkeletonTable,
  Skeleton,
} from "@/components/skeleton";

export default function IncomeTaxSkeleton() {
  return (
    <div className="px-[var(--pad-card)] py-4" aria-busy="true">
      <LoadingLabel>Loading income tax…</LoadingLabel>

      {/* Header */}
      <header className="mb-4 flex flex-col gap-2">
        <Skeleton height="1.5rem" width="14rem" />
        <Skeleton height="0.75rem" width="20rem" />
      </header>

      {/* Tabbed card: tabs bar + chart + table */}
      <SkeletonCard>
        {/* Tab bar */}
        <div className="flex gap-4 border-b border-hair pb-3 mb-4">
          <Skeleton height="1.5rem" width="5rem" />
          <Skeleton height="1.5rem" width="5rem" />
          <Skeleton height="1.5rem" width="5rem" />
        </div>

        <div className="space-y-4">
          <SkeletonChart />
          <SkeletonTable rows={10} columns={5} />
        </div>
      </SkeletonCard>
    </div>
  );
}
