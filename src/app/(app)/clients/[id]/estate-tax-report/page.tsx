import { db } from "@/db";
import {
  clients,
  scenarios,
  scenarioSnapshots,
  scenarioToggleGroups,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { parseCompareSearchParams } from "@/lib/scenario/scenario-from-search-params";
import { loadSnapshotBannerData } from "@/lib/scenario/snapshot-banner-data";
import EstateTaxReportView from "@/components/estate-tax-report-view";
import { ComparePanel } from "@/components/scenario/compare-panel";
import { CompareScenarioBar } from "@/components/scenario/compare-scenario-bar";
import { SnapshotBanner } from "@/components/scenario/snapshot-banner";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    left?: string;
    right?: string;
    toggles?: string;
  }>;
}

export default async function EstateTaxReportPage({
  params,
  searchParams,
}: PageProps) {
  const firmId = await requireOrgId();
  const { id } = await params;
  const sp = await searchParams;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    // Parent layout already handles the 404 case via notFound(); this is a
    // belt-and-suspenders fallback if scope ever drifts.
    notFound();
  }

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  const ownerNames = {
    clientName: client.firstName ?? "Client",
    spouseName: client.spouseName ?? null,
  };

  const ownerDobs = {
    clientDob: client.dateOfBirth,
    spouseDob: client.spouseDob ?? null,
  };

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const clientRetirementYear = clientBirthYear + client.retirementAge;
  const spouseRetirementYear =
    client.spouseDob && client.spouseRetirementAge != null
      ? parseInt(client.spouseDob.slice(0, 4), 10) + client.spouseRetirementAge
      : null;
  // "Retirement (Clients)" milestone = the year both have retired (later of the two).
  const retirementYear =
    spouseRetirementYear != null
      ? Math.max(clientRetirementYear, spouseRetirementYear)
      : clientRetirementYear;

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
        <EstateTaxReportView
          clientId={id}
          isMarried={isMarried}
          ownerNames={ownerNames}
          ownerDobs={ownerDobs}
          retirementYear={retirementYear}
        />
      </div>
      <ComparePanel
        clientId={id}
        scenarios={scenarioRows}
        snapshots={snapshotRows as SnapshotOption[]}
        rightToggleGroups={rightToggleGroups satisfies ToggleGroup[]}
        // TODO: real netDelta from server-loaded projection diff (deferred —
        // see future-work/reports.md "Real delta-preview wiring on Estate Tax
        // page"). Side-by-side waterfalls + headline delta also deferred there.
        netDelta={null}
        // deltaFetcher omitted intentionally — wiring real per-toggle deltas
        // is deferred (see future-work/reports.md "Real delta-preview wiring").
        // Cannot pass a stub function here: server components can't pass
        // functions to client components without a "use server" boundary.
      />
    </div>
  );
}
