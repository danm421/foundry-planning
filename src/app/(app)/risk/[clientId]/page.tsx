import { Suspense } from "react";
import { RiskDetailContent } from "./risk-detail-content";
import RiskDetailSkeleton from "./loading-skeleton";

export default function RiskDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  return (
    <Suspense fallback={<RiskDetailSkeleton />}>
      <RiskDetailContent params={params} />
    </Suspense>
  );
}
