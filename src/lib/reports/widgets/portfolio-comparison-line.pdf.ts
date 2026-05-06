// src/lib/reports/widgets/portfolio-comparison-line.pdf.ts
//
// PDF-side registration glue for the portfolioComparisonLine widget.
// Loaded only by the server-only barrel `index.pdf.ts` so the
// `@react-pdf/renderer` runtime stays out of the client bundle.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { PortfolioComparisonLinePdfRender } from "@/components/reports-pdf/widgets/portfolio-comparison-line";

registerWidgetPdf("portfolioComparisonLine", PortfolioComparisonLinePdfRender);
