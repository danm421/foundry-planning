import type { BuildDataContext } from "@/components/presentations/registry";
import type { EstatePageOptions } from "@/lib/presentations/pages/estate-shared/options-schema";
import type { DeathSectionData } from "@/lib/estate/transfer-report";
import type { OwnershipColumnData } from "@/lib/estate/estate-flow-ownership";
import { inheritanceTaxOf, irdTaxOf } from "@/lib/estate/death-taxes";
import { prepEstate } from "@/lib/presentations/shared/estate-context";
import { pickDeathColumns } from "@/lib/estate/estate-flow-death-columns";
import type { AsOfValue } from "@/components/report-controls/as-of-dropdown";

/** One death's projected tax, as the column's tax box lists it. */
export interface EstateFlowDeathTax {
  federal: number;
  state: number;
  inheritance: number;
  /** Income tax heirs owe on inherited pre-tax retirement money. */
  ird: number;
}

/** A death column as the PDF draws it. This data also reaches the Forge as
 *  JSON, so the section's full Form 706 result is swapped for the four figures
 *  the tax box prints rather than shipped as tokens. */
export type EstateFlowDeathColumnData = Omit<DeathSectionData, "estateTax"> & {
  tax: EstateFlowDeathTax;
};

export interface EstateFlowReportData {
  title: string;
  subtitle: string;
  ownership: OwnershipColumnData;
  asOfYear: number;
  firstColumn: EstateFlowDeathColumnData | null;
  secondColumn: EstateFlowDeathColumnData | null;
  showHeirDetail: boolean;
}

function toDeathColumn(section: DeathSectionData | null): EstateFlowDeathColumnData | null {
  if (!section) return null;
  const { estateTax, ...column } = section;
  return {
    ...column,
    tax: {
      federal: estateTax.federalEstateTax,
      state: estateTax.stateEstateTax,
      inheritance: inheritanceTaxOf(estateTax),
      ird: irdTaxOf(estateTax),
    },
  };
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
    firstColumn: toDeathColumn(firstColumn),
    secondColumn: toDeathColumn(secondColumn),
    showHeirDetail: options.showHeirDetail,
  };
}
