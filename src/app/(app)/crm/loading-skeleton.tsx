import { LoadingLabel, SkeletonTable } from "@/components/skeleton";

export function LoadingSkeleton() {
  return (
    <div aria-busy="true" className="p-6">
      <LoadingLabel>Loading CRM households…</LoadingLabel>
      <SkeletonTable rows={8} columns={5} />
    </div>
  );
}
