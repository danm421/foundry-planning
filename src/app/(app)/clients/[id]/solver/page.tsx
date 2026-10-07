import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { SolverContent } from "./solver-content";
import SolverSkeleton from "./loading-skeleton";
import { resolveInputTab, resolveReportParam } from "./report-tab-link";
import { requireClientPageAccess } from "@/lib/clients/page-access";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string; tab?: string; report?: string }>;
}

export default async function SolverPage({ params, searchParams }: PageProps) {
  const { orgId: firmId, userId } = await requireOrgAndUser();
  const { id: clientId } = await params;
  await requireClientPageAccess(clientId);
  const { scenario, tab, report } = await searchParams;

  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) notFound();

  const source = scenario && scenario !== "base" ? scenario : "base";

  return (
    <Suspense fallback={<SolverSkeleton />}>
      <SolverContent
        clientId={clientId}
        firmId={firmId}
        userId={userId}
        source={source}
        initialTab={resolveInputTab(tab)}
        initialReport={resolveReportParam(report)}
      />
    </Suspense>
  );
}
