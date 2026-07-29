import { LoadingLabel, SkeletonTable } from "@/components/skeleton";

export default function RiskSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingLabel>Loading risk profiles…</LoadingLabel>
      <SkeletonTable rows={8} columns={8} />
    </div>
  );
}
