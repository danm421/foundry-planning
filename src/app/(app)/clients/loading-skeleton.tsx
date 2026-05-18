import { LoadingLabel, SkeletonTable } from "@/components/skeleton";

export default function ClientsSkeleton() {
  return (
    <div aria-busy="true">
      <LoadingLabel>Loading clients…</LoadingLabel>
      <SkeletonTable rows={8} columns={3} />
    </div>
  );
}
