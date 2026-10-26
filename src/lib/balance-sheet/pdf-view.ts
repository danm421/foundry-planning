// src/lib/balance-sheet/pdf-view.ts
//
// What the printed Balance Sheet shows for one selection — the Assets tab's
// Download PDF and the presentation deck's Balance Sheet page both build
// through here, so the two print the same sheet.
import type { BalanceSheetReportProps } from "@/components/balance-sheet-report/balance-sheet-report";
import type { BalanceSheetPdfView } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import {
  agesLabel,
  buildEntityGroups,
  buildHouseholdModels,
  type BalanceSheetTab,
} from "@/components/balance-sheet-report/report-model";
import type { AsOfMode } from "@/components/balance-sheet-report/view-model";
import {
  entityFilterApplies,
  filterEntityGroups,
  prepareEntityGroups,
  type EntityFilter,
} from "./entity-groups";

const FILTER_LABELS: Record<EntityFilter, string> = { all: "All", trusts: "Trusts", businesses: "Businesses" };

export interface PrintedBalanceSheet {
  view: BalanceSheetPdfView;
  /** e.g. "Household · End of 2030 · Ages 64 & 62". */
  subtitle: string;
}

export function buildBalanceSheetPdfView(
  report: Omit<BalanceSheetReportProps, "todayYear">,
  selection: { tab: BalanceSheetTab; filter: EntityFilter; selectedYear: number; asOfMode: AsOfMode },
): PrintedBalanceSheet {
  const { tab, filter, selectedYear, asOfMode } = selection;

  let view: BalanceSheetPdfView;
  let viewLabel: string;
  if (tab === "household") {
    const { household, consolidated } = buildHouseholdModels(report, selectedYear, asOfMode);
    view = {
      kind: "household",
      household,
      donut: consolidated.donut,
      outOfEstate: consolidated,
      clientLabel: report.clientLabel,
      spouseLabel: report.spouseLabel,
    };
    viewLabel = "Household";
  } else {
    const groups = prepareEntityGroups(buildEntityGroups(report, selectedYear, asOfMode));
    const filtered = filter !== "all" && entityFilterApplies(groups);
    view = { kind: "entities", groups: filterEntityGroups(groups, filter), trustDetails: report.trustDetails ?? [] };
    viewLabel = filtered ? `By Entity · ${FILTER_LABELS[filter]}` : "By Entity";
  }

  // The year picker's "Today (2026)" and ages, spelled out for print.
  const ages = report.agesByYear?.[selectedYear];
  const subtitle = [
    viewLabel,
    asOfMode === "today" ? `Today (${new Date().getFullYear()})` : `End of ${selectedYear}`,
    ages ? `${ages.spouse != null ? "Ages" : "Age"} ${agesLabel(ages)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { view, subtitle };
}
