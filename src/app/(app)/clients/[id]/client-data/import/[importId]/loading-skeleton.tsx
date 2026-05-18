import { LoadingLabel, Skeleton, SkeletonCard, SkeletonText } from "@/components/skeleton";

export default function ImportFlowSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading import…</LoadingLabel>

      {/* Page heading row with back link and status badge */}
      <div className="flex items-center gap-3">
        <Skeleton height="1rem" width="5rem" />
        <Skeleton height="1.5rem" width="8rem" />
        <Skeleton height="1.25rem" width="4rem" radius="0.25rem" />
      </div>

      {/* Main content card */}
      <SkeletonCard>
        <SkeletonText lines={4} />
      </SkeletonCard>

      {/* Action area */}
      <SkeletonCard>
        <SkeletonText lines={2} />
      </SkeletonCard>
    </div>
  );
}
