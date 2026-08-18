// One chart, chosen by kind. Lives apart from `chapter-pdf.tsx` because that file
// already branches on LAYOUT and is long; two nested switches in one component is
// how a layout starts rendering another layout's collection.
import { PortfolioBarsPdf } from "../retirement-summary/chart-pdf";
import { TaxSummaryChartPdf } from "../tax-summary/chart-pdf";
import { EstateSummaryChartPdf } from "../estate-summary/chart-pdf";
import type { PlanStoryChart } from "@/lib/presentations/pages/plan-story/view-model";

/**
 * The story sheet's usable width: a portrait Letter page is 612pt, less
 * `PageFrame`'s 43pt of page padding each side (`shared/page-frame.tsx`), less
 * `plan-story/chapter-pdf.tsx#styles.wrap`'s 24pt each side.
 *
 * ⚠️ NOT the ~504pt the summary-page charts were tuned to. `PortfolioBarsPdf`
 * hard-coded 500 until this feature, which overflows this sheet by 22pt.
 */
const STORY_CHART_WIDTH = 478;

/** A `switch` with no `default`, so a fourth chart kind is a compile error here
 *  rather than a blank space on a client's page. */
export function PlanStoryChapterChartPdf({ chart }: { chart: PlanStoryChart }) {
  switch (chart.kind) {
    case "portfolioBars":
      return (
        <PortfolioBarsPdf
          bars={chart.bars}
          retirementYear={chart.retirementYear}
          width={STORY_CHART_WIDTH}
        />
      );
    case "taxBars":
      // 440pt, hard-coded and inside 478 — no prop to pass.
      return <TaxSummaryChartPdf bars={chart.bars} />;
    case "estateBars":
      // 300pt, hard-coded and inside 478. `totals` is what makes the money under
      // its bars read in the same spelling as the prose beside it — see the
      // prop's own note.
      return <EstateSummaryChartPdf bars={chart.bars} totals={chart.totals} />;
  }
}
