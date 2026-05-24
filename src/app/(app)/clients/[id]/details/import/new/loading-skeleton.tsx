import { LoadingLabel, Skeleton, SkeletonCard, SkeletonForm } from "@/components/skeleton";

export default function NewImportSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading new import…</LoadingLabel>

      {/* Page heading row */}
      <div className="flex items-center justify-between">
        <Skeleton height="1.5rem" width="8rem" />
        <Skeleton height="1rem" width="7rem" />
      </div>

      {/* Mode picker card */}
      <SkeletonCard>
        <SkeletonForm fields={2} />
      </SkeletonCard>
    </div>
  );
}
