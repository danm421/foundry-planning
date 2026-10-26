// The Assets tab's Balance Sheet report as a deck page: the same report data
// (buildBalanceSheetReportProps) and the same printed view
// (buildBalanceSheetPdfView) its Download PDF uses, read off the deck's own
// scenario tree and projection.
import type { BuildDataContext } from "@/components/presentations/registry";
import { buildBalanceSheetReportProps } from "@/lib/balance-sheet/build-report-props";
import { buildBalanceSheetPdfView, type PrintedBalanceSheet } from "@/lib/balance-sheet/pdf-view";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { resolveBalanceSheetYear } from "../balance-sheet/view-model";
import type { BalanceSheetReportOptions } from "./options-schema";

export type BalanceSheetReportPageData = PrintedBalanceSheet;

export function buildBalanceSheetReportPageData(
  ctx: BuildDataContext,
  options: BalanceSheetReportOptions,
): BalanceSheetReportPageData {
  const { client } = ctx.clientData;
  const report = buildBalanceSheetReportProps(ctx.clientData, ctx.years, {
    clientLabel: client.firstName || "Client",
    spouseName: client.spouseName ?? CO_CLIENT_LABEL,
  });
  return buildBalanceSheetPdfView(report, {
    tab: options.view,
    filter: "all",
    selectedYear: resolveBalanceSheetYear(ctx.years, options),
    asOfMode: options.asOf,
  });
}
