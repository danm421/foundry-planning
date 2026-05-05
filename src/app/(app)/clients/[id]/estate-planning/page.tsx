import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeNoPlanClientData } from "@/lib/estate/counterfactual";
import {
  rankTrustsByContribution,
  synthesizeDelayedTopGift,
} from "@/lib/estate/strategy-attribution";
import { CanvasFrame } from "./canvas-frame";
import { CanvasDndProvider } from "./dnd-context-provider";
import { ProjectionPanel } from "./projection/projection-panel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EstatePlanningPage({ params }: PageProps) {
  const { id: clientId } = await params;
  const firmId = await requireOrgId();

  let tree;
  try {
    const result = await loadEffectiveTree(clientId, firmId, "base", {});
    tree = result.effectiveTree;
  } catch (e) {
    if (e instanceof Error && /not found|no base case/i.test(e.message)) {
      notFound();
    }
    throw e;
  }

  // Three parallel projections. Engine is sync; Promise.all preserves the
  // plan's concurrent-friendly shape for any future async migration.
  const [withResult, withoutResult] = await Promise.all([
    Promise.resolve(runProjectionWithEvents(tree)),
    Promise.resolve(runProjectionWithEvents(synthesizeNoPlanClientData(tree))),
  ]);

  const ranked = rankTrustsByContribution(tree, withResult.years);
  const procrastinatedResult =
    ranked.length >= 1
      ? runProjectionWithEvents(synthesizeDelayedTopGift(tree, 10))
      : null;

  const clientFirstName = tree.client.firstName;
  // spouseName from ClientInfo is the full spouse name; use it as the display name
  const spouseFirstName = tree.client.spouseName ?? null;

  const taxInflationRate = tree.planSettings?.taxInflationRate ?? 0.025;

  const annualExclusionsByYear = new Map<number, number>();
  for (const r of (tree.taxYearRows ?? []) as Array<{ year: number; giftAnnualExclusion?: string | null }>) {
    if (r.giftAnnualExclusion != null) {
      annualExclusionsByYear.set(r.year, parseFloat(r.giftAnnualExclusion));
    }
  }
  const getAnnualExclusion = (y: number) => annualExclusionsByYear.get(y) ?? 0;

  return (
    <CanvasDndProvider
      clientId={clientId}
      clientFirstName={clientFirstName}
      spouseFirstName={spouseFirstName}
      tree={tree}
      giftLedger={withResult.giftLedger}
      taxInflationRate={taxInflationRate}
      getAnnualExclusion={getAnnualExclusion}
    >
      <CanvasFrame tree={tree} withResult={withResult} />
      <ProjectionPanel
        tree={tree}
        withResult={withResult}
        withoutResult={withoutResult}
        procrastinatedResult={procrastinatedResult}
        clientId={clientId}
      />
    </CanvasDndProvider>
  );
}
