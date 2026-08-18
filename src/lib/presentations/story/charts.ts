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

export interface StoryEstateChart {
  /**
   * WHICH comparison the two bars are, carried with them.
   *
   * The bars alone cannot say: both pairings are two `EstateSummaryChartBar`s
   * in the same slots, and `build-facts.ts` labels each one's figure. Reading
   * the pairing off `hasProposal` there instead would be a second spelling of
   * a decision made here — and the labels are display text, not a key.
   */
  comparison: "planVsPlan" | "todayVsEndOfLife";
  /** Exactly two. One bar is not a comparison. */
  bars: EstateSummaryChartBar[];
}

export interface StoryChartData {
  /** Stacked balances per projection year, for `willTheMoneyLast`. */
  portfolio: PortfolioBar[];
  /** Tax paid per projection year, for `whatYoullPayInTax`. */
  tax: TaxYearBar[];
  /**
   * The estate's two bars, or null when the deck cannot draw a pair.
   *
   * A proposal deck compares the current plan against the proposed plan, both
   * at end of life. A base-only deck compares today against end of life — the
   * same pair, in the same order, that the Estate Summary page draws.
   *
   * Null rather than an empty array, and the distinction is the one the whole
   * report makes elsewhere: an absent estate and an estate worth nothing are
   * different statements. An empty array would print an axis with no bars.
   */
  estate: StoryEstateChart | null;
}

export interface BuildStoryChartsInput {
  years: ProjectionYear[];
  /**
   * Built by the caller from the household summaries it already holds, rather
   * than rebuilt here.
   *
   * `load-context.ts` runs `summarizeHousehold` over each estate report it
   * builds for the fact pack, and stacks the bars from those same objects
   * through `pages/estate-summary/view-model.ts#estateChartBar` — the one
   * mapping the Estate Summary page uses too. Rebuilding either the reports or
   * the mapping here would be the duplicate derivation this module exists to
   * prevent. It also picks WHICH pair the deck compares, and says so on the
   * chart. Null when the caller cannot produce both bars.
   */
  estate: StoryEstateChart | null;
}

export function buildStoryCharts(input: BuildStoryChartsInput): StoryChartData {
  return {
    portfolio: portfolioBars(input.years),
    tax: buildTaxPaidBars(input.years),
    estate: input.estate,
  };
}
