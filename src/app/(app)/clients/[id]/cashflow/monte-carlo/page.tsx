import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  scenarios,
  scenarioSnapshots,
  scenarioToggleGroups,
} from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { parseCompareSearchParams } from "@/lib/scenario/scenario-from-search-params";
import { loadSnapshotBannerData } from "@/lib/scenario/snapshot-banner-data";
import MonteCarloReport from "@/components/monte-carlo-report";
import { ComparePanel } from "@/components/scenario/compare-panel";
import { CompareScenarioBar } from "@/components/scenario/compare-scenario-bar";
import { SnapshotBanner } from "@/components/scenario/snapshot-banner";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";

interface MonteCarloPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    scenario?: string;
    left?: string;
    right?: string;
    toggles?: string;
  }>;
}

export default async function MonteCarloPage({
  params,
  searchParams,
}: MonteCarloPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  const scenarioId = sp.scenario ?? "base";
  // toggleState wire-up via `?toggles=` lands in Phase ε — pass {} for now.
  // MonteCarloReport currently fetches via /api/clients/[id]/projection-data;
  // Phase ε threads scenarioId through that API. Forward as a prop so the
  // client component can pick it up without another page-handler change.

  const client = await findClientInFirm(id, firmId);
  if (!client) {
    // Parent layout already handles the 404 case via notFound(); this is a
    // belt-and-suspenders fallback if scope ever drifts.
    return <MonteCarloReport clientId={id} scenarioId={scenarioId} />;
  }

  const { left, right } = parseCompareSearchParams(sp);
  const isRightSnapshot = right.kind === "snapshot";

  const [
    scenarioRows,
    snapshotRows,
    liveRightToggleGroups,
    leftBanner,
    rightBanner,
  ] = await Promise.all([
    db
      .select({
        id: scenarios.id,
        name: scenarios.name,
        isBaseCase: scenarios.isBaseCase,
      })
      .from(scenarios)
      .where(eq(scenarios.clientId, id)),
    db
      .select({
        id: scenarioSnapshots.id,
        name: scenarioSnapshots.name,
        sourceKind: scenarioSnapshots.sourceKind,
      })
      .from(scenarioSnapshots)
      .where(eq(scenarioSnapshots.clientId, id)),
    right.kind === "scenario" && right.id !== "base"
      ? db
          .select({
            id: scenarioToggleGroups.id,
            scenarioId: scenarioToggleGroups.scenarioId,
            name: scenarioToggleGroups.name,
            defaultOn: scenarioToggleGroups.defaultOn,
            requiresGroupId: scenarioToggleGroups.requiresGroupId,
            orderIndex: scenarioToggleGroups.orderIndex,
          })
          .from(scenarioToggleGroups)
          .where(eq(scenarioToggleGroups.scenarioId, right.id))
          .orderBy(scenarioToggleGroups.orderIndex)
      : Promise.resolve([] as ToggleGroup[]),
    loadSnapshotBannerData(id, firmId, left),
    loadSnapshotBannerData(id, firmId, right),
  ]);

  const rightToggleGroups: ToggleGroup[] = isRightSnapshot
    ? rightBanner?.rawToggleGroupsRight ?? []
    : liveRightToggleGroups;

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">
        <CompareScenarioBar
          clientId={id}
          scenarios={scenarioRows}
          snapshots={snapshotRows as SnapshotOption[]}
        />
        {leftBanner && (
          <SnapshotBanner
            clientId={id}
            side="left"
            snapshotName={leftBanner.name}
            frozenBy={leftBanner.frozenByUserId}
            frozenAt={leftBanner.frozenAt}
          />
        )}
        {rightBanner && (
          <SnapshotBanner
            clientId={id}
            side="right"
            snapshotName={rightBanner.name}
            frozenBy={rightBanner.frozenByUserId}
            frozenAt={rightBanner.frozenAt}
          />
        )}
        <MonteCarloReport clientId={id} scenarioId={scenarioId} />
      </div>
      <ComparePanel
        clientId={id}
        scenarios={scenarioRows}
        snapshots={snapshotRows as SnapshotOption[]}
        rightToggleGroups={rightToggleGroups satisfies ToggleGroup[]}
        // TODO: real netDelta from server-loaded projection diff (deferred —
        // see future-work/reports.md "Real delta-preview wiring on Monte Carlo
        // page"). Cone-overlay + manual recompute button also deferred there.
        netDelta={null}
        // deltaFetcher omitted intentionally — wiring real per-toggle deltas
        // is deferred (see future-work/reports.md "Real delta-preview wiring").
        // Cannot pass a stub function here: server components can't pass
        // functions to client components without a "use server" boundary.
      />
    </div>
  );
}
