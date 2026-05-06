// src/lib/reports/widgets/disclaimer-block.ts
//
// Screen-side registration glue for the disclaimerBlock widget. Small-
// print boilerplate at the bottom of reports: 1.5px solid accent rule
// across the top, then padded body text in muted italic.
//
// PDF renderer attached separately by `disclaimer-block.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { DisclaimerBlockRender } from "@/components/reports/widgets/disclaimer-block";
import { DisclaimerBlockInspector } from "@/components/reports/widget-inspectors/disclaimer-block";

registerWidget({
  kind: "disclaimerBlock",
  category: "Structure",
  label: "Disclaimer Block",
  description: "Small-print boilerplate with a top accent rule.",
  allowedRowSizes: ["1-up"],
  scopes: [],
  defaultProps: {
    body: "This report is for educational and discussion purposes only. It is not a substitute for personalized financial, tax, or legal advice. Projections are based on inputs and assumptions that may differ from actual results.",
  },
  Render: DisclaimerBlockRender,
  Inspector: DisclaimerBlockInspector,
});
