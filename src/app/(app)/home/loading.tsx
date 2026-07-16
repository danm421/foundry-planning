import type { ReactElement } from "react";
import { LoadingLabel, SkeletonCard, SkeletonKpi } from "@/components/skeleton";

export default function HomeLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-4 p-[var(--pad-card)]" aria-busy="true">
      <LoadingLabel>Loading your home…</LoadingLabel>
      <div className="h-16" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonCard />
        </div>
        <SkeletonCard />
      </div>
    </div>
  );
}
