import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { EntitiesCashFlowContent } from "./entities-cashflow-content";
import EntitiesCashFlowSkeleton from "./loading-skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EntitiesCashFlowReportPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;

  const inFirm = await findClientInFirm(id, firmId);
  if (!inFirm) notFound();

  return (
    <Suspense fallback={<EntitiesCashFlowSkeleton />}>
      <EntitiesCashFlowContent id={id} firmId={firmId} />
    </Suspense>
  );
}
