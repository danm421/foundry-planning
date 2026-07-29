import { Suspense } from "react";
import { RiskContent } from "./risk-content";
import RiskSkeleton from "./loading-skeleton";

export default function RiskPage({
  searchParams,
}: {
  searchParams: Promise<{ advisor?: string; filter?: string }>;
}) {
  return (
    <Suspense fallback={<RiskSkeleton />}>
      <RiskContent searchParams={searchParams} />
    </Suspense>
  );
}
