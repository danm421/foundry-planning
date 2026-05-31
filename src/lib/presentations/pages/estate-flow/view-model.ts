import type { BuildDataContext } from "@/components/presentations/registry";
import type { EstatePageOptions } from "@/lib/presentations/pages/estate-shared/options-schema";
import type { DeathSectionData } from "@/lib/estate/transfer-report";
import type { OwnershipColumnData } from "@/lib/estate/estate-flow-ownership";
import { prepEstate } from "@/lib/presentations/shared/estate-context";
import { pickDeathColumns } from "@/lib/estate/estate-flow-death-columns";
import type { AsOfValue } from "@/components/report-controls/as-of-dropdown";

export interface EstateFlowReportData {
  title: string;
  subtitle: string;
  ownership: OwnershipColumnData;
  asOfYear: number;
  firstColumn: DeathSectionData | null;
  secondColumn: DeathSectionData | null;
  showHeirDetail: boolean;
}

// `AsOfSelection` ({kind}) → `AsOfValue` (the union pickDeathColumns expects).
function toAsOfValue(asOf: EstatePageOptions["asOf"]): AsOfValue {
  if (asOf.kind === "year") return asOf.year;
  return asOf.kind; // "today" | "split"
}

export function buildEstateFlowReportData(
  ctx: BuildDataContext,
  options: EstatePageOptions,
): EstateFlowReportData {
  const { reportData, ownership, asOfYear } = prepEstate(ctx, options.asOf, options.ordering ?? "primaryFirst");
  const [firstColumn, secondColumn] = pickDeathColumns(
    reportData,
    toAsOfValue(options.asOf),
    options.ordering ?? "primaryFirst",
  );
  return {
    title: "Estate Flow",
    subtitle: `${ctx.scenarioLabel} · As of ${asOfYear}`,
    ownership,
    asOfYear,
    firstColumn,
    secondColumn,
    showHeirDetail: options.showHeirDetail,
  };
}
