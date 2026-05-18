import { LoadingLabel, SkeletonCard, SkeletonChart, SkeletonTable, Skeleton } from "@/components/skeleton";

export default function EstateTransferSkeleton() {
  return (
    <div className="space-y-4 pt-4" aria-busy="true">
      <LoadingLabel>Loading Estate Transfer…</LoadingLabel>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
          <Skeleton height="2rem" width="5rem" radius="0.375rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton height="2rem" width="10rem" radius="0.375rem" />
          <Skeleton height="2rem" width="8rem" radius="0.375rem" />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonChart />
        <SkeletonChart />
      </div>

      {/* Transfer detail table */}
      <SkeletonCard>
        <SkeletonTable rows={8} columns={5} />
      </SkeletonCard>
    </div>
  );
}
