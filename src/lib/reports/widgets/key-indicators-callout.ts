// src/lib/reports/widgets/key-indicators-callout.ts
//
// Screen-side registration glue for the keyIndicatorsCallout widget. A
// bordered card with a bulleted list of indicators, used in the
// comparison report's "Where you are today" section. v1 reads bullets
// from `props.bullets` directly — no engine data, no scopes wired.
// (Auto-derivation from comparison thresholds is logged in
// future-work/reports.md.)
//
// PDF renderer attached separately by `key-indicators-callout.pdf.ts`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { KeyIndicatorsCalloutRender } from "@/components/reports/widgets/key-indicators-callout";
import { KeyIndicatorsCalloutInspector } from "@/components/reports/widget-inspectors/key-indicators-callout";

registerWidget({
  kind: "keyIndicatorsCallout",
  category: "Structure",
  label: "Key Indicators Callout",
  description: "Bordered card with a bulleted list of plan indicators.",
  allowedRowSizes: ["1-up", "2-up"],
  defaultProps: {
    title: "Key Indicators",
    bullets: [
      "Success rate is below the 90% confidence threshold",
      "No life insurance on either spouse",
      "Heavy reliance on tax-deferred accounts",
    ],
  },
  Render: KeyIndicatorsCalloutRender,
  Inspector: KeyIndicatorsCalloutInspector,
});
