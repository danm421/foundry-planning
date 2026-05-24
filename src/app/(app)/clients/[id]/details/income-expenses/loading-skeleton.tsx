import { LoadingLabel, SkeletonCard, SkeletonTable } from "@/components/skeleton";

export default function IncomeExpensesSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading income & expenses…</LoadingLabel>

      {/* Income section */}
      <SkeletonCard>
        <SkeletonTable rows={5} columns={4} />
      </SkeletonCard>

      {/* Expenses section */}
      <SkeletonCard>
        <SkeletonTable rows={5} columns={4} />
      </SkeletonCard>

      {/* Savings section */}
      <SkeletonCard>
        <SkeletonTable rows={3} columns={4} />
      </SkeletonCard>
    </div>
  );
}
