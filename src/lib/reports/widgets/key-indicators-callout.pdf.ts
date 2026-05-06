// src/lib/reports/widgets/key-indicators-callout.pdf.ts
//
// PDF-side registration glue for the keyIndicatorsCallout widget.

import { registerWidgetPdf } from "@/lib/reports/widget-registry";
import { KeyIndicatorsCalloutPdfRender } from "@/components/reports-pdf/widgets/key-indicators-callout";

registerWidgetPdf("keyIndicatorsCallout", KeyIndicatorsCalloutPdfRender);
