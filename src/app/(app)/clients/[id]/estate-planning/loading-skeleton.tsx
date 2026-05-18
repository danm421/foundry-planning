import { LoadingLabel, SkeletonCard, SkeletonChart, Skeleton } from "@/components/skeleton";

export default function EstatePlanningSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-1" aria-busy="true">
      <LoadingLabel>Loading Estate Planning…</LoadingLabel>

      {/* Header */}
      <header className="mb-2">
        <Skeleton height="0.625rem" width="8rem" className="mb-2" />
        <Skeleton height="1.375rem" width="14rem" />
      </header>

      {/* Time-period controls bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
        </div>
        <Skeleton height="2rem" width="10rem" radius="0.375rem" />
      </div>

      {/* Canvas: 3-column grid — in-estate | spine | out-of-estate */}
      <div className="grid grid-cols-[320px_1fr_360px] gap-0 rounded-[10px] border border-[var(--color-hair)] bg-[var(--color-card)] mb-6">
        {/* In-Estate column */}
        <div className="border-r border-[var(--color-hair)] p-4 flex flex-col gap-3">
          <Skeleton height="0.75rem" width="60%" />
          <SkeletonCard className="min-h-[120px]" />
          <SkeletonCard className="min-h-[80px]" />
          <SkeletonCard className="min-h-[80px]" />
        </div>

        {/* Spine column */}
        <div className="min-h-[480px] flex flex-col items-center justify-center gap-4 p-4">
          <Skeleton height="3rem" width="6rem" radius="0.5rem" />
          <Skeleton height="1px" width="80%" />
          <Skeleton height="3rem" width="6rem" radius="0.5rem" />
          <Skeleton height="1px" width="80%" />
          <Skeleton height="3rem" width="6rem" radius="0.5rem" />
        </div>

        {/* Out-of-Estate column */}
        <div className="border-l border-[var(--color-hair)] p-4 flex flex-col gap-3">
          <Skeleton height="0.75rem" width="60%" />
          <SkeletonCard className="min-h-[120px]" />
          <SkeletonCard className="min-h-[80px]" />
          <SkeletonCard className="min-h-[80px]" />
        </div>
      </div>

      {/* Projection panel */}
      <SkeletonCard className="p-6">
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Skeleton height="2rem" width="8rem" radius="0.375rem" />
            <Skeleton height="2rem" width="8rem" radius="0.375rem" />
            <Skeleton height="2rem" width="6rem" radius="0.375rem" />
          </div>
          <Skeleton height="1.25rem" width="60%" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Skeleton height="4rem" radius="0.375rem" />
            <Skeleton height="4rem" radius="0.375rem" />
            <Skeleton height="4rem" radius="0.375rem" />
            <Skeleton height="4rem" radius="0.375rem" />
          </div>
          <SkeletonChart />
        </div>
      </SkeletonCard>
    </div>
  );
}
