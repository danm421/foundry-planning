// src/lib/reports/widgets/monte-carlo-fan.ts
//
// Screen-side registration glue for the monteCarloFan widget. Imported
// as a side effect from `src/lib/reports/widgets/index.ts`, which is in
// turn imported by the builder so `registerWidget` runs before the
// reducer's `makeWidget`.
//
// The PDF renderer is attached separately by `monte-carlo-fan.pdf.ts`
// (loaded only by the server-only barrel `index.pdf.ts`) so the
// `@react-pdf/renderer` runtime never reaches the client builder bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { MonteCarloFanRender } from "@/components/reports/widgets/monte-carlo-fan";
import { MonteCarloFanInspector } from "@/components/reports/widget-inspectors/monte-carlo-fan";

registerWidget({
  kind: "monteCarloFan",
  category: "Chart",
  label: "Monte Carlo",
  description: "Probability fan with success-rate headline.",
  allowedRowSizes: ["1-up"],
  scopes: ["monteCarlo"],
  defaultProps: {
    title: "Monte Carlo outlook",
    yearRange: { from: "default", to: "default" },
    scenarioId: null,
    bands: [5, 25, 50, 75, 95],
    showHeadline: true,
  },
  Render: MonteCarloFanRender,
  Inspector: MonteCarloFanInspector,
});
