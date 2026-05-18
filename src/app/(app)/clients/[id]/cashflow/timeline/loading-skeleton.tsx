import { LoadingLabel, Skeleton, SkeletonCard } from "@/components/skeleton";

export default function TimelineSkeleton() {
  return (
    <div
      className="relative min-h-screen bg-[#0B0F1A]"
      aria-busy="true"
    >
      <LoadingLabel>Loading timeline…</LoadingLabel>

      <div className="relative p-6">
        {/* Title */}
        <Skeleton height="2.5rem" width="12rem" />
        <Skeleton height="0.75rem" width="10rem" className="mt-2" />

        {/* Controls bar */}
        <div className="mt-6 flex gap-3">
          <Skeleton height="1.75rem" width="6rem" />
          <Skeleton height="1.75rem" width="6rem" />
          <Skeleton height="1.75rem" width="6rem" />
        </div>

        {/* Minimap / sparkline */}
        <div className="mt-3">
          <Skeleton height="4rem" className="w-full rounded-lg" />
        </div>

        {/* Timeline spine rows */}
        <div className="mt-6 flex flex-col gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} className="bg-white/[0.03] border-white/[0.06]" />
          ))}
        </div>
      </div>
    </div>
  );
}
