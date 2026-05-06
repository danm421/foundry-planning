// src/lib/reports/widgets/risk-table.ts
//
// Screen-side registration glue for the riskTable widget. Three-column
// branded table (Risk Area / Description / Severity) with a colored
// severity-pill column. Pure prop-driven widget — no engine data, no
// scopes wired.
//
// PDF renderer attached separately by `risk-table.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { RiskTableRender } from "@/components/reports/widgets/risk-table";
import { RiskTableInspector } from "@/components/reports/widget-inspectors/risk-table";

registerWidget({
  kind: "riskTable",
  category: "Data Table",
  label: "Risk Table",
  description:
    "Branded table of identified risks with a colored severity-pill column.",
  allowedRowSizes: ["1-up"],
  defaultProps: {
    title: "Identified Risks",
    rows: [
      {
        area: "Longevity",
        description: "Plan may run short if markets underperform",
        severity: "high",
      },
      {
        area: "Insurance Gap",
        description:
          "No life insurance leaves surviving spouse with major income shortfall",
        severity: "high",
      },
      {
        area: "Tax Exposure",
        description: "Heavy tax-deferred balances will create large RMDs",
        severity: "medium",
      },
    ],
  },
  Render: RiskTableRender,
  Inspector: RiskTableInspector,
});
