import { LoadingLabel, Skeleton, SkeletonForm } from "@/components/skeleton";

export default function BrandingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <LoadingLabel>Loading Branding…</LoadingLabel>

      {/* Page heading */}
      <Skeleton height="1.25rem" width="6rem" />

      {/* Description */}
      <Skeleton height="0.875rem" width="75%" />

      {/* Logo card */}
      <div className="flex flex-col gap-3 rounded border border-hair p-4">
        <Skeleton height="0.875rem" width="3rem" />
        <div className="flex items-center gap-4">
          <Skeleton height="5rem" width="7.5rem" radius="0.375rem" />
          <SkeletonForm fields={1} className="flex-1" />
        </div>
      </div>

      {/* Favicon card */}
      <div className="flex flex-col gap-3 rounded border border-hair p-4">
        <Skeleton height="0.875rem" width="4.5rem" />
        <div className="flex items-center gap-4">
          <Skeleton height="5rem" width="7.5rem" radius="0.375rem" />
          <SkeletonForm fields={1} className="flex-1" />
        </div>
      </div>

      {/* Primary color card */}
      <div className="flex flex-col gap-3 rounded border border-hair p-4">
        <Skeleton height="0.875rem" width="7rem" />
        <div className="flex items-center gap-3">
          <Skeleton height="2rem" width="2rem" radius="0.375rem" />
          <Skeleton height="2.25rem" width="8rem" radius="0.375rem" />
          <Skeleton height="2.25rem" width="4rem" radius="0.375rem" />
        </div>
      </div>
    </div>
  );
}
