import { LoadingLabel, SkeletonCard, SkeletonText } from "@/components/skeleton";

export default function WillsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading wills…</LoadingLabel>

      {/* Client will card */}
      <SkeletonCard>
        <SkeletonText lines={4} />
      </SkeletonCard>

      {/* Spouse will card */}
      <SkeletonCard>
        <SkeletonText lines={4} />
      </SkeletonCard>

      {/* Beneficiaries / recipients section */}
      <SkeletonCard>
        <SkeletonText lines={3} />
      </SkeletonCard>
    </div>
  );
}
