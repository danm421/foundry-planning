import { LoadingLabel, Skeleton, SkeletonForm } from "@/components/skeleton";

export default function FirmSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <LoadingLabel>Loading Firm…</LoadingLabel>

      {/* Page heading */}
      <Skeleton height="1.25rem" width="3rem" />

      {/* Form fields: firm display name input + firm ID text + save button */}
      <SkeletonForm fields={1} />
      <Skeleton height="0.75rem" width="12rem" />
      <Skeleton height="2.25rem" width="5rem" radius="0.375rem" />
    </div>
  );
}
