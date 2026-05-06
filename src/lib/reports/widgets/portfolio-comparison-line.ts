// src/lib/reports/widgets/portfolio-comparison-line.ts
//
// Screen-side registration glue for the portfolioComparisonLine widget.
// The data-loader stamps each instance's `widgetData[id]` with the resolved
// `ComparisonScopeData` when the report has a `comparisonBinding`, so this
// widget declares no engine scopes — it consumes the comparison payload
// directly. The PDF render is attached separately by
// `portfolio-comparison-line.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { PortfolioComparisonLineRender } from "@/components/reports/widgets/portfolio-comparison-line";
import { PortfolioComparisonLineInspector } from "@/components/reports/widget-inspectors/portfolio-comparison-line";

registerWidget({
  kind: "portfolioComparisonLine",
  category: "Chart",
  label: "Portfolio Comparison Line",
  description: "Two-line chart comparing portfolio growth: current vs proposed.",
  allowedRowSizes: ["1-up", "2-up"],
  defaultProps: {
    title: "Portfolio Growth Projection",
    yearRange: { from: "default", to: "default" },
    showGrid: true,
  },
  Render: PortfolioComparisonLineRender,
  Inspector: PortfolioComparisonLineInspector,
});
