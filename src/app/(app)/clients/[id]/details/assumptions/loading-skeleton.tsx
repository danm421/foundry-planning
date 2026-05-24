import { LoadingLabel, SkeletonCard, SkeletonForm, SkeletonText } from "@/components/skeleton";

export default function AssumptionsSkeleton() {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true">
      <LoadingLabel>Loading assumptions…</LoadingLabel>

      {/* Page heading */}
      <SkeletonText lines={2} />

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
