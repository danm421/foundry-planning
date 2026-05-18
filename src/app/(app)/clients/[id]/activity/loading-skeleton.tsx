import { LoadingLabel, SkeletonTable } from "@/components/skeleton";

export default function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <LoadingLabel>Loading activity…</LoadingLabel>
      <SkeletonTable rows={8} columns={4} />
    </div>
  );
}
