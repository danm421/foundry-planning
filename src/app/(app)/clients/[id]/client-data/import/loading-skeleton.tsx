import { LoadingLabel, Skeleton, SkeletonCard, SkeletonText } from "@/components/skeleton";

export default function ImportListSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading imports…</LoadingLabel>

      {/* Page heading row */}
      <div className="flex items-center justify-between">
        <Skeleton height="1.5rem" width="8rem" />
        <Skeleton height="2rem" width="7rem" radius="0.375rem" />
      </div>

      {/* In-progress section */}
      <SkeletonCard>
        <div className="flex flex-col gap-3">
          <Skeleton height="0.75rem" width="6rem" />
          <SkeletonText lines={3} />
        </div>
      </SkeletonCard>

      {/* Completed section */}
      <SkeletonCard>
        <div className="flex flex-col gap-3">
          <Skeleton height="0.75rem" width="5rem" />
          <SkeletonText lines={2} />
        </div>
      </SkeletonCard>
    </div>
  );
}
