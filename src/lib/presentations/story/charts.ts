// The arrays the story's charts draw, built ONCE per report.
//
// Why this module exists: the chart's figures have to become `Fact`s the prose is
// required to cite (`build-facts.ts`), and the same figures have to be drawn
// (`pages/plan-story/view-model.ts`). Deriving them twice — once for the pack and
// once for the render — is how the picture and the paragraph beside it start
// disagreeing about a number. So the arrays are built here, put on
// `StoryContext.charts`, and both consumers read the same objects.
import type { ProjectionYear } from "@/engine/types";
import { portfolioBars, type PortfolioBar } from "@/lib/presentations/pages/retirement-summary/aggregate";
import { buildTaxPaidBars, type TaxYearBar } from "@/lib/presentations/pages/tax-summary/aggregate";
import type { EstateSummaryChartBar } from "@/lib/presentations/pages/estate-summary/view-model";

export interface StoryChartData {
  /** Stacked balances per projection year, for `willTheMoneyLast`. */
  portfolio: PortfolioBar[];
  /** Tax paid per projection year, for `whatYoullPayInTax`. */
  tax: TaxYearBar[];
  /**
   * The estate's today-vs-end-of-life bars, for `whatsLeftForPeople` — or null
   * when the deck has no estate report to take them from.
   *
   * Null rather than an empty array, and the distinction is the one the whole
   * report makes elsewhere: an absent estate and an estate worth nothing are
   * different statements. An empty array would print an axis with no bars.
   */
  estate: EstateSummaryChartBar[] | null;
}

export interface BuildStoryChartsInput {
  years: ProjectionYear[];
  /**
   * Taken from the estate page's own view-model rather than rebuilt here.
   *
   * `pages/estate-summary/view-model.ts` builds these through
   * `buildEstateTransferReportData` and `summarizeHousehold`; reproducing that
   * chain would be a second derivation of the same two bars, which is exactly what
   * this module exists to prevent. Null when the caller has no estate data.
   */
  estateBars: EstateSummaryChartBar[] | null;
}

export function buildStoryCharts(input: BuildStoryChartsInput): StoryChartData {
  return {
    portfolio: portfolioBars(input.years),
    tax: buildTaxPaidBars(input.years),
    estate: input.estateBars,
  };
}
