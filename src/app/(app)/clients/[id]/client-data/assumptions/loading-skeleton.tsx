import { LoadingLabel, SkeletonCard, SkeletonForm } from "@/components/skeleton";

export default function AssumptionsSkeleton() {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true">
      <LoadingLabel>Loading assumptions…</LoadingLabel>

      {/* Page heading */}
      <SkeletonCard className="space-y-2">
        <SkeletonForm fields={0} />
      </SkeletonCard>

      {/* Main form sections */}
      <SkeletonCard>
        <SkeletonForm fields={5} />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonForm fields={4} />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonForm fields={3} />
      </SkeletonCard>
    </div>
  );
}
