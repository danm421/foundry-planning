// src/lib/reports/widgets/net-worth-line.ts
//
// Screen-side registration glue for the netWorthLine widget. Imported
// as a side effect from `src/lib/reports/widgets/index.ts`, which is in
// turn imported by the builder so `registerWidget` runs before the
// reducer's `makeWidget`.
//
// The PDF renderer is attached separately by `net-worth-line.pdf.ts`
// (loaded only by the server-only barrel `index.pdf.ts`) so the
// `@react-pdf/renderer` runtime never reaches the client builder bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { NetWorthLineRender } from "@/components/reports/widgets/net-worth-line";
import { NetWorthLineInspector } from "@/components/reports/widget-inspectors/net-worth-line";

registerWidget({
  kind: "netWorthLine",
  category: "Chart",
  label: "Net worth trajectory",
  description: "Year-by-year net worth line chart.",
  allowedRowSizes: ["1-up", "2-up"],
  scopes: ["balance"],
  defaultProps: {
    title: "Net worth over time",
    yearRange: { from: "default", to: "default" },
    ownership: "consolidated",
    compareScenarioId: null,
    showMarkers: false,
    showGrid: true,
  },
  Render: NetWorthLineRender,
  Inspector: NetWorthLineInspector,
});
