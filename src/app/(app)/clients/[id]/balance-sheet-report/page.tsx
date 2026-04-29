import { db } from "@/db";
import {
  clients,
  entities,
  scenarios,
  scenarioSnapshots,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireOrgId } from "@/lib/db-helpers";
import { parseCompareSearchParams } from "@/lib/scenario/scenario-from-search-params";
import { loadSnapshotBannerData } from "@/lib/scenario/snapshot-banner-data";
import BalanceSheetReportView from "@/components/balance-sheet-report-view";
import { CompareScenarioBar } from "@/components/scenario/compare-scenario-bar";
import { SnapshotBanner } from "@/components/scenario/snapshot-banner";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    left?: string;
    right?: string;
    toggles?: string;
  }>;
}

export default async function BalanceSheetReportPage({
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

  const { left, right } = parseCompareSearchParams(sp);

  const [entityRows, scenarioRows, snapshotRows, leftBanner, rightBanner] =
    await Promise.all([
      db.select().from(entities).where(eq(entities.clientId, id)),
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
      loadSnapshotBannerData(id, firmId, left),
      loadSnapshotBannerData(id, firmId, right),
    ]);

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

  const entityInfos = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
  }));

  return (
    <div>
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
      <BalanceSheetReportView
        clientId={id}
        isMarried={isMarried}
        ownerNames={ownerNames}
        ownerDobs={ownerDobs}
        entities={entityInfos}
      />
    </div>
  );
}
