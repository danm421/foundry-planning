import { LoadingLabel, SkeletonCard, SkeletonTable, Skeleton } from "@/components/skeleton";

export default function EstateTaxSkeleton() {
  return (
    <div className="space-y-4 pt-4" aria-busy="true">
      <LoadingLabel>Loading Estate Tax…</LoadingLabel>

      {/* Time-period controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
        </div>
        <Skeleton height="2rem" width="10rem" radius="0.375rem" />
      </div>

      {/* Decedent breakdown card */}
      <SkeletonCard>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="1.25rem" width="6rem" />
          </div>
          <SkeletonTable rows={6} columns={2} />
        </div>
      </SkeletonCard>

      {/* Second decedent / grand totals card */}
      <SkeletonCard>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="1.25rem" width="6rem" />
          </div>
          <SkeletonTable rows={4} columns={2} />
        </div>
      </SkeletonCard>
    </div>
  );
}
