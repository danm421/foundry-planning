import { Suspense } from "react";
import { requireOrgId } from "@/lib/db-helpers";
import { parseEstateCompareSearchParams } from "@/lib/scenario/scenario-from-search-params";
import { EstatePlanningContent } from "./estate-planning-content";
import EstatePlanningSkeleton from "./loading-skeleton";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function EstatePlanningPage({ params, searchParams }: PageProps) {
  const { id: clientId } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();

  const { left, right } = parseEstateCompareSearchParams(sp);

  return (
    <Suspense fallback={<EstatePlanningSkeleton />}>
      <EstatePlanningContent
        clientId={clientId}
        firmId={firmId}
        left={left}
        right={right}
      />
    </Suspense>
  );
}
