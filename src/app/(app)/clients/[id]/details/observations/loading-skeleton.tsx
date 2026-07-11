import { LoadingLabel, SkeletonCard, SkeletonText } from "@/components/skeleton";

export default function ObservationsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading observations…</LoadingLabel>

      {/* Observations */}
      <SkeletonCard>
        <SkeletonText lines={3} />
      </SkeletonCard>

      {/* Next steps */}
      <SkeletonCard>
        <SkeletonText lines={4} />
      </SkeletonCard>
    </div>
  );
}
