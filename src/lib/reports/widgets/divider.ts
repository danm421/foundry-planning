// src/lib/reports/widgets/divider.ts
//
// Registration glue for the divider widget — a single hairline rule that
// users can drop into a row to break a page visually. No props, no
// engine data.

import { registerWidget } from "@/lib/reports/widget-registry";
import { DividerRender } from "@/components/reports/widgets/divider";
import { DividerInspector } from "@/components/reports/widget-inspectors/divider";

registerWidget({
  kind: "divider",
  category: "Structure",
  label: "Divider",
  description: "Single hairline rule. Splits a page visually.",
  allowedRowSizes: ["1-up"],
  defaultProps: {},
  Render: DividerRender,
  Inspector: DividerInspector,
});
