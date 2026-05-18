import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function TechniquesSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading techniques…</LoadingLabel>

      {/* Transfers section */}
      <SkeletonCard>
        <SkeletonTable rows={4} columns={4} />
      </SkeletonCard>

      {/* Roth conversions section */}
      <SkeletonCard>
        <SkeletonTable rows={3} columns={4} />
      </SkeletonCard>

      {/* Asset transactions section */}
      <SkeletonCard>
        <SkeletonTable rows={3} columns={4} />
      </SkeletonCard>
    </div>
  );
}
