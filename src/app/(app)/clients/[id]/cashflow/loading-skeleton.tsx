import {
  LoadingLabel,
  SkeletonCard,
  SkeletonChart,
  SkeletonKpi,
  SkeletonTable,
} from "@/components/skeleton";

export default function CashFlowSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <LoadingLabel>Loading cash flow…</LoadingLabel>

      {/* Chart area */}
      <SkeletonChart />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>

      {/* Main cash-flow table */}
      <SkeletonCard>
        <SkeletonTable rows={8} columns={6} />
      </SkeletonCard>
    </div>
  );
}
