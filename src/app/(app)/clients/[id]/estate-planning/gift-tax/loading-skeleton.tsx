import { LoadingLabel, SkeletonCard, SkeletonTable, Skeleton } from "@/components/skeleton";

export default function GiftTaxSkeleton() {
  return (
    <div className="gift-tax-report-printable p-4 space-y-4" aria-busy="true">
      <LoadingLabel>Loading Gift Tax…</LoadingLabel>

      {/* Report title */}
      <Skeleton height="1.5rem" width="12rem" />

      {/* Year-by-year gift cumulative table */}
      <SkeletonCard>
        <SkeletonTable rows={8} columns={5} />
      </SkeletonCard>
    </div>
  );
}
