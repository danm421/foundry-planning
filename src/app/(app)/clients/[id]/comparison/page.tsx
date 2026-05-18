import { Suspense } from "react";
import { requireOrgId } from "@/lib/db-helpers";
import { ComparisonContent } from "./comparison-content";
import ComparisonSkeleton from "./loading-skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ComparisonPage({ params }: PageProps) {
  const { id: clientId } = await params;
  const firmId = await requireOrgId();

  return (
    <Suspense fallback={<ComparisonSkeleton />}>
      <ComparisonContent clientId={clientId} firmId={firmId} />
    </Suspense>
  );
}
