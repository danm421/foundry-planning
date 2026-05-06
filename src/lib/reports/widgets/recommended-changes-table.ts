// src/lib/reports/widgets/recommended-changes-table.ts
//
// Screen-side registration glue for the recommendedChangesTable widget.
// Used by the comparison report's executive summary (single-column "list"
// variant) and the §5 detail section (3-column "currentVsProposed"
// variant). Each row is a hand-edited entry; v1 does NOT auto-derive from
// the comparison scope (logged in future-work/reports.md).
//
// PDF renderer attached separately by `recommended-changes-table.pdf.ts`
// so the `@react-pdf/renderer` runtime never reaches the client builder
// bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { RecommendedChangesTableRender } from "@/components/reports/widgets/recommended-changes-table";
import { RecommendedChangesTableInspector } from "@/components/reports/widget-inspectors/recommended-changes-table";

registerWidget({
  kind: "recommendedChangesTable",
  category: "Data Table",
  label: "Recommended Changes",
  description:
    "Branded table of recommended changes. List variant for executive summary; current/proposed variant for §5 detail.",
  allowedRowSizes: ["1-up"],
  defaultProps: {
    title: "Recommended Changes",
    variant: "list",
    rows: [
      { change: "Increase savings rate" },
      { change: "Delay Social Security to 70" },
      { change: "Establish a trust" },
    ],
  },
  Render: RecommendedChangesTableRender,
  Inspector: RecommendedChangesTableInspector,
});
