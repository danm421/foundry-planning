import { LoadingLabel, SkeletonCard, SkeletonChart, SkeletonTable, Skeleton } from "@/components/skeleton";

export default function LiquiditySkeleton() {
  return (
    <div className="space-y-4 pt-4" aria-busy="true">
      <LoadingLabel>Loading Liquidity…</LoadingLabel>

      {/* Export controls */}
      <div className="flex justify-end gap-2">
        <Skeleton height="2rem" width="9rem" radius="0.375rem" />
        <Skeleton height="2rem" width="7rem" radius="0.375rem" />
      </div>

      {/* Liquidity chart */}
      <SkeletonChart />

      {/* Yearly table */}
      <SkeletonCard>
        <SkeletonTable rows={8} columns={5} />
      </SkeletonCard>
    </div>
  );
}
