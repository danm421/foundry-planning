import {
  LoadingLabel,
  SkeletonCard,
  SkeletonTable,
  Skeleton,
} from "@/components/skeleton";

export default function EntitiesCashFlowSkeleton() {
  return (
    <div className="flex flex-col gap-0" aria-busy="true">
      <LoadingLabel>Loading entities cash flow…</LoadingLabel>

      {/* Header controls bar */}
      <div className="flex items-center gap-3 border-b border-hair px-4 py-3">
        <Skeleton height="2rem" width="12rem" />
        <Skeleton height="2rem" width="10rem" />
        <Skeleton height="2rem" width="6rem" className="ml-auto" />
      </div>

      {/* Entity table */}
      <div className="p-4">
        <SkeletonCard>
          <SkeletonTable rows={8} columns={5} />
        </SkeletonCard>
      </div>
    </div>
  );
}
