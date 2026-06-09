// Pure transform: ProjectionYear[] + the selected entity → EntityCashFlowPageData.
// Reuses the in-app selector so the deck page and the in-app view stay in lockstep.
import type { ProjectionYear } from "@/engine/types";
import { filterYearsToRange, type RangeOption } from "@/lib/presentations/shared/year-filter";
import { selectEntityRows } from "@/components/entities-cashflow-report/view-model";
import type { EntityCashFlowPageData } from "./types";

export interface BuildEntityCashFlowInput {
  years: ProjectionYear[];
  entityId: string;
  entityName: string;
  range: RangeOption;
  scenarioLabel: string;
}

export function buildEntityCashFlowPageData(input: BuildEntityCashFlowInput): EntityCashFlowPageData {
  const visible = filterYearsToRange(input.years, input.range);
  const selected = selectEntityRows({
    years: visible,
    entityId: input.entityId,
    startYear: visible[0]?.year ?? Number.NEGATIVE_INFINITY,
    endYear: visible[visible.length - 1]?.year ?? Number.POSITIVE_INFINITY,
  });
  const entityName = selected.rows[0]?.entityName ?? input.entityName;
  return {
    title: entityName ? `Business & Trusts — ${entityName}` : "Business & Trusts",
    subtitle: input.scenarioLabel,
    selected,
  };
}
