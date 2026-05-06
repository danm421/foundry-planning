// src/lib/reports/widgets/comparison-donut-pair.pdf.ts
//
// PDF-side registration glue for the comparisonDonutPair widget. Loaded
// only by the server-only barrel `index.pdf.ts`.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { ComparisonDonutPairPdfRender } from "@/components/reports-pdf/widgets/comparison-donut-pair";

registerWidgetPdf("comparisonDonutPair", ComparisonDonutPairPdfRender);
