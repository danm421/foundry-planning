import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function BalanceSheetReportSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading balance sheet…</LoadingLabel>

      {/* Assets table */}
      <SkeletonCard>
        <SkeletonTable rows={6} columns={5} />
      </SkeletonCard>

      {/* Liabilities table */}
      <SkeletonCard>
        <SkeletonTable rows={3} columns={5} />
      </SkeletonCard>
    </div>
  );
}
