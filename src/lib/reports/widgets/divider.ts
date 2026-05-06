// src/lib/reports/widgets/divider.ts
//
// Registration glue for the divider widget — a horizontal rule users can
// drop into a row to break a page visually. The `variant` prop toggles
// between the default hairline (`hair`) and a 1.5pt accent rule
// (`accent`). No engine data.

import { registerWidget } from "@/lib/reports/widget-registry";
import { DividerRender } from "@/components/reports/widgets/divider";
import { DividerInspector } from "@/components/reports/widget-inspectors/divider";

registerWidget({
  kind: "divider",
  category: "Structure",
  label: "Divider",
  description: "Horizontal rule (hair or accent). Splits a page visually.",
  allowedRowSizes: ["1-up"],
  defaultProps: { variant: "hair" },
  Render: DividerRender,
  Inspector: DividerInspector,
});
