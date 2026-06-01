import { LoadingLabel, Skeleton, SkeletonCard, SkeletonChart, SkeletonTable } from "@/components/skeleton";

export default function InvestmentsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading Investments…</LoadingLabel>

      {/* Header: nav + benchmark selector */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <Skeleton height="0.75rem" width="16rem" />
            <Skeleton height="1.25rem" width="14rem" />
          </div>
          <Skeleton height="2rem" width="10rem" radius="0.375rem" />
        </div>
        {/* View toggle */}
        <div className="flex gap-2">
          <Skeleton height="2rem" width="5.5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5.5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5.5rem" radius="0.375rem" />
        </div>
      </header>

      {/* 3-column grid: allocation table | donut | drift chart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
        <SkeletonCard>
          <Skeleton height="0.875rem" width="8rem" className="mb-3" />
          <SkeletonTable rows={6} columns={3} />
        </SkeletonCard>

        <SkeletonCard>
          <SkeletonChart />
          <Skeleton height="0.75rem" width="60%" className="mx-auto mt-3" />
        </SkeletonCard>

        <SkeletonCard>
          <Skeleton height="0.875rem" width="7rem" className="mb-3" />
          <SkeletonChart />
        </SkeletonCard>
      </div>

      {/* Footer action row */}
      <div className="flex items-center gap-2 border-t border-hair pt-4">
        <Skeleton height="2rem" width="6rem" radius="0.375rem" />
        <Skeleton height="2rem" width="8rem" radius="0.375rem" />
      </div>
    </div>
  );
}
