// src/lib/reports/widgets/monte-carlo-comparison-bars.pdf.ts
//
// PDF-side registration glue for the monteCarloComparisonBars widget.
// Loaded only by the server-only barrel `index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { MonteCarloComparisonBarsPdfRender } from "@/components/reports-pdf/widgets/monte-carlo-comparison-bars";

registerWidgetPdf("monteCarloComparisonBars", MonteCarloComparisonBarsPdfRender);
