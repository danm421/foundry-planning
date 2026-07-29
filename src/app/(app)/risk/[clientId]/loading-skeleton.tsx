import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function RiskDetailSkeleton() {
  return (
    <div className="p-6" aria-busy="true">
      <LoadingLabel>Loading risk profile…</LoadingLabel>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="mt-6">
        <SkeletonTable rows={5} columns={3} />
      </div>
    </div>
  );
}
