import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { LiveSolverWorkspace } from "./live-solver-workspace";

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

  const [baseLoaded, sourceLoaded] = await Promise.all([
    loadEffectiveTree(clientId, firmId, "base", {}),
    source === "base"
      ? null
      : loadEffectiveTree(clientId, firmId, source, {}),
  ]);

  const baseProjection = runProjection(baseLoaded.effectiveTree);
  const sourceProjection = sourceLoaded
    ? runProjection(sourceLoaded.effectiveTree)
    : baseProjection;

  const scenarioRows = await db
    .select({ id: scenarios.id, name: scenarios.name })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, false)));

  return (
    <LiveSolverWorkspace
      clientId={clientId}
      baseClientData={baseLoaded.effectiveTree}
      baseProjection={baseProjection}
      initialSource={source}
      initialSourceClientData={sourceLoaded?.effectiveTree ?? baseLoaded.effectiveTree}
      initialSourceProjection={sourceProjection}
      availableScenarios={scenarioRows}
    />
  );
}
