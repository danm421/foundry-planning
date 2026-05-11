import { YearByYearComparisonSection } from "@/components/comparison/year-by-year-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";

export const yearByYearWidget: ComparisonWidgetDefinition = {
  kind: "year-by-year",
  title: "Year-by-year detail",
  needsMc: false,
  render: ({ plans, yearRange }) => (
    <YearByYearComparisonSection plans={plans} yearRange={yearRange} />
  ),
};
