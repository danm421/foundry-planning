import type { BuildDataContext } from "@/components/presentations/registry";
import type { EstatePageOptions } from "@/lib/presentations/pages/estate-shared/options-schema";
import type { DeathSectionData } from "@/lib/estate/transfer-report";
import type { OwnershipColumnData } from "@/lib/estate/estate-flow-ownership";
import { prepEstate } from "@/lib/presentations/shared/estate-context";
import { pickDeathColumns } from "@/lib/estate/estate-flow-death-columns";
import type { AsOfValue } from "@/components/report-controls/as-of-dropdown";

/** A death column as the PDF draws it. The PDF shows no tax calculation, and
 *  this data also reaches the Forge as JSON — so the section's full Form 706
 *  result is dropped rather than shipped as tokens. */
export type EstateFlowDeathColumnData = Omit<DeathSectionData, "estateTax">;

export interface EstateFlowReportData {
  title: string;
  subtitle: string;
  ownership: OwnershipColumnData;
  asOfYear: number;
  firstColumn: EstateFlowDeathColumnData | null;
  secondColumn: EstateFlowDeathColumnData | null;
  showHeirDetail: boolean;
}

function withoutTaxResult(section: DeathSectionData | null): EstateFlowDeathColumnData | null {
  if (!section) return null;
  const { estateTax: _estateTax, ...column } = section;
  void _estateTax;
  return column;
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
    firstColumn: withoutTaxResult(firstColumn),
    secondColumn: withoutTaxResult(secondColumn),
    showHeirDetail: options.showHeirDetail,
  };
}
