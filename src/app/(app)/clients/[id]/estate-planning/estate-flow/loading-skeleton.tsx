import { LoadingLabel, SkeletonCard, SkeletonTable, Skeleton } from "@/components/skeleton";

export default function EstateFlowSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4" aria-busy="true">
      <LoadingLabel>Loading Estate Flow…</LoadingLabel>

      {/* Scenario picker + tab bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton height="2rem" width="7rem" radius="0.375rem" />
          <Skeleton height="2rem" width="7rem" radius="0.375rem" />
        </div>
        <Skeleton height="2rem" width="10rem" radius="0.375rem" />
      </div>

      {/* Estate-flow main area: two panels (in-estate + out-of-estate) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonCard>
          <div className="flex flex-col gap-3">
            <Skeleton height="0.875rem" width="50%" />
            <SkeletonTable rows={5} columns={3} />
          </div>
        </SkeletonCard>
        <SkeletonCard>
          <div className="flex flex-col gap-3">
            <Skeleton height="0.875rem" width="50%" />
            <SkeletonTable rows={5} columns={3} />
          </div>
        </SkeletonCard>
      </div>

      {/* Gift / transfer cards row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
