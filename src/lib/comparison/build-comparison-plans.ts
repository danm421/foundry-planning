import type { ScenarioRef } from "@/lib/scenario/loader";
import type { LoadedProjection } from "@/lib/scenario/load-projection-for-ref";
import type { YearlyEstateRow, YearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { sumLifetimeTax, type LifetimeTaxSummary } from "./lifetime-tax";
import type { ComparisonChangesDrawerPlan } from "@/app/(app)/clients/[id]/comparison/comparison-changes-drawer";
import type { HouseholdAllocation } from "@/lib/investments/allocation";

export interface ComparisonPlan {
  index: number;
  isBaseline: boolean;
  ref: ScenarioRef;
  /** Canonical URL token for this plan: "base" | `<scenarioId>` | "snap:<snapshotId>". */
  id: string;
  label: string;
  tree: ClientData;
  result: ProjectionResult;
  lifetime: LifetimeTaxSummary;
  liquidityRows: YearlyLiquidityReport["rows"];
  finalEstate: YearlyEstateRow | null;
  panelData: ComparisonChangesDrawerPlan | null;
  allocation: HouseholdAllocation | null;
}

export interface BuildComparisonPlansInput {
  refs: ScenarioRef[];
  loadProjection: (ref: ScenarioRef) => Promise<LoadedProjection>;
  loadPanel: (
    ref: ScenarioRef,
    label: string,
  ) => Promise<ComparisonChangesDrawerPlan | null>;
  loadAllocation: (loaded: LoadedProjection) => Promise<HouseholdAllocation | null>;
  buildEstateRows: (loaded: LoadedProjection) => YearlyEstateReport;
  buildLiquidityRows: (loaded: LoadedProjection) => YearlyLiquidityReport;
}

export async function buildComparisonPlans(
  input: BuildComparisonPlansInput,
): Promise<ComparisonPlan[]> {
  const loaded = await Promise.all(
    input.refs.map((ref) => input.loadProjection(ref)),
  );
  const [panels, allocations] = await Promise.all([
    Promise.all(
      input.refs.map((ref, i) => input.loadPanel(ref, loaded[i].scenarioName)),
    ),
    Promise.all(loaded.map((l) => input.loadAllocation(l))),
  ]);
  return loaded.map((l, i) => {
    const estate = input.buildEstateRows(l);
    const liquidity = input.buildLiquidityRows(l);
    return {
      index: i,
      isBaseline: i === 0,
      ref: input.refs[i],
      id: refToToken(input.refs[i]),
      label: l.scenarioName,
      tree: l.tree,
      result: l.result,
      lifetime: sumLifetimeTax(l.result.years),
      liquidityRows: liquidity.rows,
      finalEstate: estate.rows.at(-1) ?? null,
      panelData: panels[i],
      allocation: allocations[i],
    };
  });
}

function refToToken(ref: ScenarioRef): string {
  if (ref.kind === "snapshot") return `snap:${ref.id}`;
  return ref.id;
}
