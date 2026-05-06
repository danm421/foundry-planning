// src/lib/reports/widgets/monte-carlo-comparison-bars.ts
//
// Screen-side registration glue for the monteCarloComparisonBars widget.
// Reads `comparison.delta.successProbability.{current, proposed}` from the
// data-loader-stamped `widgetData[id]` payload. No engine scopes declared
// — the comparison data flows in via the report-level binding loader.

import { registerWidget } from "@/lib/reports/widget-registry";
import { MonteCarloComparisonBarsRender } from "@/components/reports/widgets/monte-carlo-comparison-bars";
import { MonteCarloComparisonBarsInspector } from "@/components/reports/widget-inspectors/monte-carlo-comparison-bars";

registerWidget({
  kind: "monteCarloComparisonBars",
  category: "Chart",
  label: "Monte Carlo Comparison",
  description: "Two bars comparing current vs proposed Monte Carlo success rate.",
  allowedRowSizes: ["1-up", "2-up"],
  defaultProps: {
    title: "Monte Carlo: Probability of Success",
  },
  Render: MonteCarloComparisonBarsRender,
  Inspector: MonteCarloComparisonBarsInspector,
});
