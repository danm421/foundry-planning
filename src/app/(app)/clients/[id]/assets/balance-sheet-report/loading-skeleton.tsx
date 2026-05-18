import { LoadingLabel, Skeleton, SkeletonCard, SkeletonChart } from "@/components/skeleton";

export default function BalanceSheetReportSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading Balance Sheet…</LoadingLabel>

      {/* Header controls: year selector + view toggle + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton height="2rem" width="7rem" radius="0.375rem" />
          <Skeleton height="2rem" width="7rem" radius="0.375rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton height="2rem" width="6rem" radius="0.375rem" />
          <Skeleton height="2rem" width="6rem" radius="0.375rem" />
          <Skeleton height="2rem" width="6rem" radius="0.375rem" />
        </div>
      </div>

      {/* 3-column layout: assets | center (donut + bar) | liabilities */}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr_1fr]">
        {/* Assets panel */}
        <SkeletonCard>
          <Skeleton height="0.875rem" width="4rem" className="mb-3" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <Skeleton height="0.75rem" width="50%" />
              <Skeleton height="0.75rem" width="25%" />
            </div>
          ))}
          <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3">
            <Skeleton height="0.875rem" width="35%" />
            <Skeleton height="0.875rem" width="25%" />
          </div>
        </SkeletonCard>

        {/* Center column: donut + bar */}
        <SkeletonCard>
          <SkeletonChart />
          <div className="mt-4">
            <SkeletonChart />
          </div>
        </SkeletonCard>

        {/* Liabilities panel */}
        <SkeletonCard>
          <Skeleton height="0.875rem" width="5rem" className="mb-3" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <Skeleton height="0.75rem" width="50%" />
              <Skeleton height="0.75rem" width="25%" />
            </div>
          ))}
          <div className="mt-3 flex items-center justify-between border-t border-gray-700 pt-3">
            <Skeleton height="0.875rem" width="35%" />
            <Skeleton height="0.875rem" width="25%" />
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}
