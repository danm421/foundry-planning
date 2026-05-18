import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { ComparisonContent } from "./comparison-content";
import ComparisonSkeleton from "./loading-skeleton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ComparisonPage({ params }: PageProps) {
  const firmId = await requireOrgId();
  const { id: clientId } = await params;

  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) notFound();

  return (
    <Suspense fallback={<ComparisonSkeleton />}>
      <ComparisonContent clientId={clientId} firmId={firmId} />
    </Suspense>
  );
}
