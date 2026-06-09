import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function StockOptionsSkeleton() {
  return (
    <div className="flex flex-col gap-0" aria-busy="true">
      <LoadingLabel>Loading stock options…</LoadingLabel>
      <div className="p-4">
        <SkeletonCard>
          <SkeletonTable rows={6} columns={10} />
        </SkeletonCard>
      </div>
    </div>
  );
}
