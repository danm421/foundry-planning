import { LoadingLabel, SkeletonCard, SkeletonText } from "@/components/skeleton";

export default function FamilySkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading family…</LoadingLabel>

      {/* Primary client info card */}
      <SkeletonCard>
        <SkeletonText lines={4} />
      </SkeletonCard>

      {/* Family members grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SkeletonCard>
          <SkeletonText lines={3} />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonText lines={3} />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonText lines={3} />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonText lines={3} />
        </SkeletonCard>
      </div>

      {/* Entities card */}
      <SkeletonCard>
        <SkeletonText lines={3} />
      </SkeletonCard>
    </div>
  );
}
