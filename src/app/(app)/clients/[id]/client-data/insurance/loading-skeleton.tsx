import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function InsuranceSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading insurance…</LoadingLabel>

      {/* Life insurance accounts */}
      <SkeletonCard>
        <SkeletonTable rows={4} columns={4} />
      </SkeletonCard>

      {/* Other insurance accounts */}
      <SkeletonCard>
        <SkeletonTable rows={3} columns={4} />
      </SkeletonCard>
    </div>
  );
}
