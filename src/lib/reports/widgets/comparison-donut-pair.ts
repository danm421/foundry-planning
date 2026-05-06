// src/lib/reports/widgets/comparison-donut-pair.ts
//
// Screen-side registration glue for the comparisonDonutPair widget. The
// data-loader stamps `widgetData[id]` with the resolved
// `ComparisonScopeData`; the widget reads
// `comparison.{current, proposed}.allocation` (each an
// `AllocationScopeData`). No engine scopes declared here — the comparison
// payload flows in via the report-level binding loader.

import { registerWidget } from "@/lib/reports/widget-registry";
import { ComparisonDonutPairRender } from "@/components/reports/widgets/comparison-donut-pair";
import { ComparisonDonutPairInspector } from "@/components/reports/widget-inspectors/comparison-donut-pair";

registerWidget({
  kind: "comparisonDonutPair",
  category: "Chart",
  label: "Comparison Donut Pair",
  description: "Two donuts (current left, proposed right) with shared legend.",
  allowedRowSizes: ["1-up"],
  defaultProps: {
    title: "Asset Allocation Comparison",
    asOfYear: "current",
    showLegend: true,
  },
  Render: ComparisonDonutPairRender,
  Inspector: ComparisonDonutPairInspector,
});
