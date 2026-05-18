import { Suspense } from "react";
import { requireOrgId } from "@/lib/db-helpers";
import { EntitiesCashFlowContent } from "./entities-cashflow-content";
import EntitiesCashFlowSkeleton from "./loading-skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EntitiesCashFlowReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  return (
    <Suspense fallback={<EntitiesCashFlowSkeleton />}>
      <EntitiesCashFlowContent id={id} firmId={firmId} />
    </Suspense>
  );
}
