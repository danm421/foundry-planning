import type { BuildDataContext } from "@/components/presentations/registry";
import type { EstatePageOptions } from "@/lib/presentations/pages/estate-shared/options-schema";
import type { EstateFlowSummary } from "@/lib/estate/estate-flow-summary";
import { prepEstate } from "@/lib/presentations/shared/estate-context";

export interface EstateFlowChartData {
  title: string;
  subtitle: string;
  summary: EstateFlowSummary | null;
  showHeirDetail: boolean;
}

export function buildEstateFlowChartData(
  ctx: BuildDataContext,
  options: EstatePageOptions,
): EstateFlowChartData {
  const { summary, asOfYear } = prepEstate(ctx, options.asOf);
  return {
    title: "Estate Flow",
    subtitle: `${ctx.scenarioLabel} · As of ${asOfYear}`,
    summary,
    showHeirDetail: options.showHeirDetail,
  };
}
