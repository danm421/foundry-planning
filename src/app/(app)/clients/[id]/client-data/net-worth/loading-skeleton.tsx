import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function NetWorthSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading net worth…</LoadingLabel>

      {/* Accounts section */}
      <SkeletonCard>
        <SkeletonTable rows={6} columns={4} />
      </SkeletonCard>

      {/* Liabilities section */}
      <SkeletonCard>
        <SkeletonTable rows={3} columns={4} />
      </SkeletonCard>
    </div>
  );
}
