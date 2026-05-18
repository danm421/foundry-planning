import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { LiveSolverWorkspace } from "./live-solver-workspace";

interface Props {
  clientId: string;
  firmId: string;
  source: string;
}

export async function SolverContent({ clientId, firmId, source }: Props) {
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
      key={source}
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
