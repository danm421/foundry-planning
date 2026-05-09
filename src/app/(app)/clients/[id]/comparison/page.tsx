import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios as scenariosTable, scenarioSnapshots, clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { parseCompareSearchParams } from "@/lib/scenario/scenario-from-search-params";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { sumLifetimeTax } from "@/lib/comparison/lifetime-tax";
import {
  computeEndingNetWorth,
  computeYearsPortfolioSurvives,
  computeEstateTotals,
} from "@/lib/comparison/kpi";
import { buildYearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import type { SnapshotOption } from "@/components/scenario/scenario-picker-dropdown";
import type { ComparisonChangesDrawerPlan } from "./comparison-changes-drawer";
import { ComparisonPickerBar } from "./comparison-picker-bar";
import { ComparisonShell } from "./comparison-shell";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ComparisonPage({ params, searchParams }: PageProps) {
  const { id: clientId } = await params;
  const sp = await searchParams;
  const firmId = await requireOrgId();

  const { left, right } = parseCompareSearchParams(sp);

  const plan2Provided =
    sp.right !== undefined && sp.right !== "" && sp.right !== sp.left;

  const [scenarios, snapshots, plan1Load, plan2Load] = await Promise.all([
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
    loadProjectionForRef(clientId, firmId, left).catch((e: unknown) => {
      if (e instanceof Error && /not found|no base case/i.test(e.message)) notFound();
      throw e;
    }),
    loadProjectionForRef(clientId, firmId, right).catch((e: unknown) => {
      if (e instanceof Error && /not found|no base case/i.test(e.message)) notFound();
      throw e;
    }),
  ]);

  const endingNetWorthDelta =
    computeEndingNetWorth(plan2Load.result.years) -
    computeEndingNetWorth(plan1Load.result.years);

  const plan1Lifetime = sumLifetimeTax(plan1Load.result.years);
  const plan2Lifetime = sumLifetimeTax(plan2Load.result.years);
  const lifetimeTaxDelta = plan2Lifetime.total - plan1Lifetime.total;

  const estate1 = computeEstateTotals(plan1Load.result);
  const estate2 = computeEstateTotals(plan2Load.result);
  const estateTaxDelta =
    estate2.totalEstateTax +
    estate2.totalAdminExpenses -
    (estate1.totalEstateTax + estate1.totalAdminExpenses);

  const clientInfo = plan1Load.tree.client;
  const ownerNames = {
    clientName: `${clientInfo.firstName} ${clientInfo.lastName}`.trim(),
    spouseName: clientInfo.spouseName ?? null,
  };
  const ownerDobs = {
    clientDob: clientInfo.dateOfBirth,
    spouseDob: clientInfo.spouseDob ?? null,
  };

  const heirs1 = buildYearlyEstateReport({
    projection: plan1Load.result,
    clientData: plan1Load.tree,
    ordering: "primaryFirst",
    ownerNames,
    ownerDobs,
  });
  const heirs2 = buildYearlyEstateReport({
    projection: plan2Load.result,
    clientData: plan2Load.tree,
    ordering: "primaryFirst",
    ownerNames,
    ownerDobs,
  });
  const toHeirsDelta = heirs2.totals.totalToHeirs - heirs1.totals.totalToHeirs;

  const liquidity1 = buildYearlyLiquidityReport({
    projection: plan1Load.result,
    clientData: plan1Load.tree,
    ownerNames,
    ownerDobs,
  });
  const liquidity2 = buildYearlyLiquidityReport({
    projection: plan2Load.result,
    clientData: plan2Load.tree,
    ownerNames,
    ownerDobs,
  });

  const finalEstate1 = heirs1.rows[heirs1.rows.length - 1] ?? null;
  const finalEstate2 = heirs2.rows[heirs2.rows.length - 1] ?? null;

  const yearsSurvivesDelta =
    computeYearsPortfolioSurvives(plan2Load.result.years) -
    computeYearsPortfolioSurvives(plan1Load.result.years);

  // Panel data for the changes drawer — fetched only for live scenario refs
  // (base + snapshot refs have nothing editable). Done in parallel; both can
  // independently resolve to null if the ref doesn't belong to this firm or
  // points at the base case.
  const drawerPlans: ComparisonChangesDrawerPlan[] = [];
  const panelLoadable = (
    ref: typeof left,
    label: string,
  ): Promise<ComparisonChangesDrawerPlan | null> | null => {
    if (ref.kind !== "scenario" || ref.id === "base") return null;
    return loadPanelData(clientId, ref.id, firmId).then((d) =>
      d
        ? {
            scenarioId: d.scenarioId,
            scenarioName: d.scenarioName,
            label,
            changes: d.changes,
            toggleGroups: d.toggleGroups,
            cascadeWarnings: d.cascadeWarnings,
            targetNames: d.targetNames,
          }
        : null,
    );
  };
  const [leftPanel, rightPanel] = await Promise.all([
    panelLoadable(left, plan1Load.scenarioName),
    panelLoadable(right, plan2Load.scenarioName),
  ]);
  if (leftPanel) drawerPlans.push(leftPanel);
  if (rightPanel) drawerPlans.push(rightPanel);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <ComparisonPickerBar
        clientId={clientId}
        scenarios={scenarios}
        snapshots={snapshots as SnapshotOption[]}
        drawerPlans={drawerPlans}
      />
      <ComparisonShell
        clientId={clientId}
        plan1Id={left.kind === "scenario" ? left.id : ""}
        plan2Id={right.kind === "scenario" ? right.id : ""}
        plan1Label={plan1Load.scenarioName}
        plan2Label={plan2Load.scenarioName}
        plan1Tree={plan1Load.tree}
        plan2Tree={plan2Load.tree}
        plan1Result={plan1Load.result}
        plan2Result={plan2Load.result}
        plan1Lifetime={plan1Lifetime}
        plan2Lifetime={plan2Lifetime}
        endingNetWorthDelta={endingNetWorthDelta}
        lifetimeTaxDelta={lifetimeTaxDelta}
        toHeirsDelta={toHeirsDelta}
        estateTaxDelta={estateTaxDelta}
        yearsSurvivesDelta={yearsSurvivesDelta}
        plan2Provided={plan2Provided}
        liquidity1Rows={liquidity1.rows}
        liquidity2Rows={liquidity2.rows}
        finalEstate1={finalEstate1}
        finalEstate2={finalEstate2}
      />
    </div>
  );
}
