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
   * The estate's current-plan-vs-proposed-plan bars, both at end of life, for
   * `whatsLeftForPeople` — or null when the deck cannot draw the pair.
   *
   * ⚠️ NOT today vs end of life, which is what the Estate Summary page draws
   * from the same component. This chapter argues what the changes do to what
   * reaches the heirs, so its picture compares the two plans.
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
   * Built by the caller from the household summaries it already holds, rather
   * than rebuilt here.
   *
   * `load-context.ts` runs `summarizeHousehold` over each plan's end-of-life
   * estate report for the fact pack, and stacks the bars from those same two
   * objects through `pages/estate-summary/view-model.ts#estateChartBar` — the
   * one mapping the Estate Summary page uses too. Rebuilding either the reports
   * or the mapping here would be the duplicate derivation this module exists to
   * prevent. Null when the caller cannot produce both bars.
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
