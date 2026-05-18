import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function BalanceSheetSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading balance sheet…</LoadingLabel>

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
