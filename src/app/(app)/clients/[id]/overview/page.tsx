import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { OverviewContent } from "./overview-content";
import OverviewSkeleton from "./loading-skeleton";

export const dynamic = "force-dynamic";

export default async function ClientOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string; toggles?: string }>;
}) {
  const firmId = await getOrgId();
  const { id } = await params;
  const sp = await searchParams;
  const scenarioId = sp.scenario ?? "base";
  if (!(await findClientInFirm(id, firmId))) notFound();

  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent clientId={id} firmId={firmId} scenarioId={scenarioId} />
    </Suspense>
  );
}
