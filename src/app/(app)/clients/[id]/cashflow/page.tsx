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
import CashFlowReport from "@/components/cashflow-report";
import { ComparePanel } from "@/components/scenario/compare-panel";
import { CompareScenarioBar } from "@/components/scenario/compare-scenario-bar";
import { SnapshotBanner } from "@/components/scenario/snapshot-banner";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";

interface CashFlowPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    left?: string;
    right?: string;
    toggles?: string;
  }>;
}

export default async function CashFlowPage({
  params,
  searchParams,
}: CashFlowPageProps) {
  const { id: clientId } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();
  const client = await findClientInFirm(clientId, firmId);
  if (!client) {
    // Parent layout already handles the 404 case via notFound(); this is a
    // belt-and-suspenders fallback if scope ever drifts.
    return <CashFlowReport clientId={clientId} />;
  }

  const { left, right } = parseCompareSearchParams(sp);

  // When right is a live scenario, we read its toggle groups from the live
  // table. When right is a snapshot, the snapshot row carries the frozen
  // groups in `rawToggleGroupsRight` — no live lookup, so the user sees
  // exactly what was on/off at freeze time even if the source scenario was
  // edited or deleted.
  const isRightSnapshot = right.kind === "snapshot";
  const [scenarioRows, snapshotRows, liveRightToggleGroups, leftBanner, rightBanner] =
    await Promise.all([
      db
        .select({
          id: scenarios.id,
          name: scenarios.name,
          isBaseCase: scenarios.isBaseCase,
        })
        .from(scenarios)
        .where(eq(scenarios.clientId, clientId)),
      db
        .select({
          id: scenarioSnapshots.id,
          name: scenarioSnapshots.name,
          sourceKind: scenarioSnapshots.sourceKind,
        })
        .from(scenarioSnapshots)
        .where(eq(scenarioSnapshots.clientId, clientId)),
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
      loadSnapshotBannerData(clientId, firmId, left),
      loadSnapshotBannerData(clientId, firmId, right),
    ]);

  const rightToggleGroups: ToggleGroup[] = isRightSnapshot
    ? rightBanner?.rawToggleGroupsRight ?? []
    : liveRightToggleGroups;

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">
        <CompareScenarioBar
          clientId={clientId}
          scenarios={scenarioRows}
          snapshots={snapshotRows as SnapshotOption[]}
        />
        {leftBanner && (
          <SnapshotBanner
            clientId={clientId}
            side="left"
            snapshotName={leftBanner.name}
            frozenBy={leftBanner.frozenByUserId}
            frozenAt={leftBanner.frozenAt}
          />
        )}
        {rightBanner && (
          <SnapshotBanner
            clientId={clientId}
            side="right"
            snapshotName={rightBanner.name}
            frozenBy={rightBanner.frozenByUserId}
            frozenAt={rightBanner.frozenAt}
          />
        )}
        <CashFlowReport clientId={clientId} />
      </div>
      <ComparePanel
        clientId={clientId}
        scenarios={scenarioRows}
        snapshots={snapshotRows as SnapshotOption[]}
        rightToggleGroups={rightToggleGroups satisfies ToggleGroup[]}
        // TODO: real netDelta from server-loaded projection diff (deferred —
        // see future-work/reports.md "Real delta-preview wiring on Cash Flow
        // page").
        netDelta={null}
        // deltaFetcher omitted intentionally — wiring real per-toggle deltas
        // is deferred (see future-work/reports.md "Real delta-preview wiring").
        // Cannot pass a stub function here: server components can't pass
        // functions to client components without a "use server" boundary.
      />
    </div>
  );
}
