// src/lib/reports/widgets/risk-severity-bar.ts
//
// Screen-side registration glue for the riskSeverityBar widget.
// Horizontal bar chart — one bar per risk row. Bar length = severity
// tier (low=1, medium=2, high=3); bar color = severity color from the
// design system. Pure prop-driven widget — no engine data, no scopes.
//
// Allowed in 1-up and 2-up slots. PDF renderer attached separately by
// `risk-severity-bar.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { RiskSeverityBarRender } from "@/components/reports/widgets/risk-severity-bar";
import { RiskSeverityBarInspector } from "@/components/reports/widget-inspectors/risk-severity-bar";

registerWidget({
  kind: "riskSeverityBar",
  category: "Chart",
  label: "Risk Severity Bar",
  description:
    "Horizontal bar chart of risks. Bar length is severity tier (low/medium/high); color matches the design-system severity palette.",
  allowedRowSizes: ["1-up", "2-up"],
  defaultProps: {
    title: "Risk Severity Assessment",
    rows: [
      { area: "Longevity", severity: "high" },
      { area: "Insurance Gap", severity: "high" },
      { area: "Tax Exposure", severity: "medium" },
    ],
  },
  Render: RiskSeverityBarRender,
  Inspector: RiskSeverityBarInspector,
});
