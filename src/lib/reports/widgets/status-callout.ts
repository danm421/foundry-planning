// src/lib/reports/widgets/status-callout.ts
//
// Screen-side registration glue for the statusCallout widget. Rounded
// card with a colored left border, tinted background, and a leading
// status glyph (✓ / ⚠ / !). Used wherever the report needs a "go / warn
// / risk" semantic callout.
//
// Pure structural widget — no engine data, no scopes wired.
//
// PDF renderer attached separately by `status-callout.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { StatusCalloutRender } from "@/components/reports/widgets/status-callout";
import { StatusCalloutInspector } from "@/components/reports/widget-inspectors/status-callout";

registerWidget({
  kind: "statusCallout",
  category: "Structure",
  label: "Status Callout",
  description:
    'Rounded card with colored left border + tinted background. "Go", "warn", or "risk" semantics.',
  allowedRowSizes: ["1-up"],
  defaultProps: {
    status: "go",
    headline: "All set",
    body: "Comprehensive estate plan in place",
  },
  Render: StatusCalloutRender,
  Inspector: StatusCalloutInspector,
});
