// src/app/(app)/clients/[id]/comparison/page.tsx
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios as scenariosTable, scenarioSnapshots, clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { parsePlansSearchParam } from "@/lib/scenario/scenario-from-search-params";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { buildYearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import { buildComparisonPlans } from "@/lib/comparison/build-comparison-plans";
import { loadLayout } from "@/lib/comparison/load-layout";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";
import { ComparisonPageClient } from "./comparison-page-client";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ComparisonPage({ params, searchParams }: PageProps) {
  const { id: clientId } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();

  const refs = parsePlansSearchParam(sp);

  const [scenarios, snapshots, plans, initialLayout] = await Promise.all([
    db
      .select({
        id: scenariosTable.id,
        name: scenariosTable.name,
        isBaseCase: scenariosTable.isBaseCase,
      })
      .from(scenariosTable)
      .innerJoin(clients, eq(clients.id, scenariosTable.clientId))
      .where(and(eq(scenariosTable.clientId, clientId), eq(clients.firmId, firmId))),
    db
      .select({
        id: scenarioSnapshots.id,
        name: scenarioSnapshots.name,
        sourceKind: scenarioSnapshots.sourceKind,
      })
      .from(scenarioSnapshots)
      .innerJoin(clients, eq(clients.id, scenarioSnapshots.clientId))
      .where(and(eq(scenarioSnapshots.clientId, clientId), eq(clients.firmId, firmId))),
    buildComparisonPlans({
      refs,
      loadProjection: (ref) =>
        loadProjectionForRef(clientId, firmId, ref).catch((e: unknown) => {
          if (e instanceof Error && /not found|no base case/i.test(e.message)) notFound();
          throw e;
        }),
      loadPanel: async (ref, label) => {
        if (ref.kind !== "scenario" || ref.id === "base") return null;
        const d = await loadPanelData(clientId, ref.id, firmId);
        if (!d) return null;
        return {
          scenarioId: d.scenarioId,
          scenarioName: d.scenarioName,
          label,
          changes: d.changes,
          toggleGroups: d.toggleGroups,
          cascadeWarnings: d.cascadeWarnings,
          targetNames: d.targetNames,
        };
      },
      buildEstateRows: (l) => {
        const clientInfo = l.tree.client;
        return buildYearlyEstateReport({
          projection: l.result,
          clientData: l.tree,
          ordering: "primaryFirst",
          ownerNames: {
            clientName: `${clientInfo.firstName} ${clientInfo.lastName}`.trim(),
            spouseName: clientInfo.spouseName ?? null,
          },
          ownerDobs: {
            clientDob: clientInfo.dateOfBirth,
            spouseDob: clientInfo.spouseDob ?? null,
          },
        });
      },
      buildLiquidityRows: (l) => {
        const clientInfo = l.tree.client;
        return buildYearlyLiquidityReport({
          projection: l.result,
          clientData: l.tree,
          ownerNames: {
            clientName: `${clientInfo.firstName} ${clientInfo.lastName}`.trim(),
            spouseName: clientInfo.spouseName ?? null,
          },
          ownerDobs: {
            clientDob: clientInfo.dateOfBirth,
            spouseDob: clientInfo.spouseDob ?? null,
          },
        });
      },
    }),
    loadLayout(clientId, firmId),
  ]);

  const drawerPlans = plans.map((p) => p.panelData).filter((p) => p !== null);

  return (
    <ComparisonPageClient
      clientId={clientId}
      plans={plans}
      initialLayout={initialLayout}
      scenarios={scenarios}
      snapshots={snapshots as SnapshotOption[]}
      drawerPlans={drawerPlans}
    />
  );
}
