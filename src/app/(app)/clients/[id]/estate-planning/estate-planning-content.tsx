import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  scenarios as scenariosTable,
  scenarioSnapshots,
} from "@/db/schema";
import type { EstateCompareRef } from "@/lib/scenario/scenario-from-search-params";
import {
  loadProjectionForRef,
  type LoadedProjection,
} from "@/lib/scenario/load-projection-for-ref";
import { runProjectionWithEvents } from "@/engine";
import {
  rankTrustsByContribution,
  synthesizeDelayedTopGift,
} from "@/lib/estate/strategy-attribution";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";
import { CanvasFrame } from "./canvas-frame";
import { CanvasDndProvider } from "./dnd-context-provider";
import { ProjectionPanel } from "./projection/projection-panel";

interface Props {
  clientId: string;
  firmId: string;
  left: EstateCompareRef;
  right: EstateCompareRef;
}

export async function EstatePlanningContent({ clientId, firmId, left, right }: Props) {
  let leftLoad: LoadedProjection;
  let rightLoad: LoadedProjection;
  try {
    [leftLoad, rightLoad] = await Promise.all([
      loadProjectionForRef(clientId, firmId, left),
      loadProjectionForRef(clientId, firmId, right),
    ]);
  } catch (e) {
    if (e instanceof Error && /not found|no base case/i.test(e.message)) {
      notFound();
    }
    throw e;
  }

  const [scenarioRows, snapshotRows] = await Promise.all([
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .where(eq(scenariosTable.clientId, clientId)),
    db
      .select({
        id: scenarioSnapshots.id,
        name: scenarioSnapshots.name,
        sourceKind: scenarioSnapshots.sourceKind,
      })
      .from(scenarioSnapshots)
      .where(eq(scenarioSnapshots.clientId, clientId)),
  ]);

  // Strategy cards always derive from the *right* projection (Plan 2).
  const ranked = rankTrustsByContribution(rightLoad.tree, rightLoad.result.years);
  const procrastinatedResult =
    !rightLoad.isDoNothing && ranked.length >= 1
      ? runProjectionWithEvents(synthesizeDelayedTopGift(rightLoad.tree, 10))
      : null;

  // Canvas + drop / dnd / annual-exclusion plumbing reads from the right tree.
  const tree = rightLoad.tree;
  const clientFirstName = tree.client.firstName;
  const spouseFirstName = tree.client.spouseName ?? null;
  const taxInflationRate = tree.planSettings?.taxInflationRate ?? 0.025;

  const annualExclusions: Array<[number, number]> = [];
  for (const r of (tree.taxYearRows ?? []) as Array<{
    year: number;
    giftAnnualExclusion?: string | null;
  }>) {
    if (r.giftAnnualExclusion != null) {
      annualExclusions.push([r.year, parseFloat(r.giftAnnualExclusion)]);
    }
  }

  return (
    <CanvasDndProvider
      clientId={clientId}
      clientFirstName={clientFirstName}
      spouseFirstName={spouseFirstName}
      tree={tree}
      giftLedger={rightLoad.result.giftLedger}
      taxInflationRate={taxInflationRate}
      annualExclusions={annualExclusions}
    >
      <CanvasFrame
        tree={tree}
        withResult={rightLoad.result}
        giftLedger={rightLoad.result.giftLedger}
      />
      <ProjectionPanel
        clientId={clientId}
        leftTree={leftLoad.tree}
        leftResult={leftLoad.result}
        leftScenarioId={refToUrlValue(left)}
        leftScenarioName={leftLoad.scenarioName}
        leftIsDoNothing={leftLoad.isDoNothing}
        rightTree={tree}
        rightResult={rightLoad.result}
        rightScenarioId={refToUrlValue(right)}
        rightScenarioName={rightLoad.scenarioName}
        rightIsDoNothing={rightLoad.isDoNothing}
        procrastinatedResult={procrastinatedResult}
        scenarios={scenarioRows}
        snapshots={snapshotRows as SnapshotOption[]}
      />
    </CanvasDndProvider>
  );
}

function refToUrlValue(ref: EstateCompareRef): string {
  if (ref.kind === "do-nothing") return "do-nothing";
  if (ref.kind === "snapshot") return `snap:${ref.id}`;
  return ref.id;
}
