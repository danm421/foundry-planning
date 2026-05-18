import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { SolverContent } from "./solver-content";
import SolverSkeleton from "./loading-skeleton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}

export default async function SolverPage({ params, searchParams }: PageProps) {
  const firmId = await requireOrgId();
  const { id: clientId } = await params;
  const { scenario } = await searchParams;

  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) notFound();

  const source = scenario && scenario !== "base" ? scenario : "base";

  return (
    <Suspense fallback={<SolverSkeleton />}>
      <SolverContent clientId={clientId} firmId={firmId} source={source} />
    </Suspense>
  );
}
