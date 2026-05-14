import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { buildComparisonPlans } from "@/lib/comparison/build-comparison-plans";
import { loadComparison } from "@/lib/comparison/load-layout";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import { loadAllocationForPlan } from "@/lib/comparison/load-allocation-for-plan";
import { buildYearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { ScenarioRef } from "@/lib/scenario/loader";
import { resolveBranding, type BrandingResolved } from "./branding";
import {
  clientByIdInFirm,
  resolveAdvisorName,
  type ClientForExport,
} from "./client-fetch";

export interface ExportData {
  client: ClientForExport;
  layout: ComparisonLayoutV5;
  comparisonName: string;
  plans: ComparisonPlan[];
  branding: BrandingResolved;
  advisorName: string;
  asOf: Date;
}

export interface LoadExportDataInput {
  clientId: string;
  firmId: string;
  comparisonId: string;
}

function tokenToRef(tok: string): ScenarioRef {
  if (!tok || tok === "base") return { kind: "scenario", id: "base", toggleState: {} };
  if (tok.startsWith("snap:")) return { kind: "snapshot", id: tok.slice("snap:".length), side: "left" };
  return { kind: "scenario", id: tok, toggleState: {} };
}

function uniquePlanTokens(layout: ComparisonLayoutV5): string[] {
  const set = new Set<string>();
  for (const g of layout.groups) {
    for (const c of g.cells) {
      if (!c.widget) continue;
      for (const pid of c.widget.planIds) set.add(pid);
    }
  }
  return Array.from(set);
}

export async function loadExportData(
  input: LoadExportDataInput,
): Promise<ExportData | null> {
  const { clientId, firmId, comparisonId } = input;
  const client = await clientByIdInFirm(clientId, firmId);
  if (!client) return null;

  const comparison = await loadComparison(comparisonId, clientId, firmId, {
    defaultTitle: "Comparison Report",
  });
  if (!comparison) return null;

  const tokens = uniquePlanTokens(comparison.layout);
  const refs = tokens.map(tokenToRef);

  const [plans, branding, advisorName] = await Promise.all([
    refs.length === 0
      ? Promise.resolve([])
      : buildComparisonPlans({
          refs,
          loadProjection: (ref) => loadProjectionForRef(clientId, firmId, ref),
          loadPanel: async (ref, scenarioName) => {
            if (ref.kind !== "scenario" || ref.id === "base") return null;
            const data = await loadPanelData(clientId, ref.id, firmId);
            if (!data) return null;
            return { ...data, label: scenarioName };
          },
          loadAllocation: (loaded) =>
            loadAllocationForPlan({ clientId, firmId, loaded }),
          buildEstateRows: (l) => {
            const c = l.tree.client;
            return buildYearlyEstateReport({
              projection: l.result,
              clientData: l.tree,
              ordering: "primaryFirst",
              ownerNames: {
                clientName: `${c.firstName} ${c.lastName}`.trim(),
                spouseName: c.spouseName ?? null,
              },
              ownerDobs: { clientDob: c.dateOfBirth, spouseDob: c.spouseDob ?? null },
            });
          },
          buildLiquidityRows: (l) => {
            const c = l.tree.client;
            return buildYearlyLiquidityReport({
              projection: l.result,
              clientData: l.tree,
              ownerNames: {
                clientName: `${c.firstName} ${c.lastName}`.trim(),
                spouseName: c.spouseName ?? null,
              },
              ownerDobs: { clientDob: c.dateOfBirth, spouseDob: c.spouseDob ?? null },
            });
          },
        }),
    resolveBranding(firmId),
    resolveAdvisorName(client.advisorId),
  ]);

  return {
    client,
    layout: comparison.layout,
    comparisonName: comparison.name,
    plans,
    branding,
    advisorName,
    asOf: new Date(),
  };
}
