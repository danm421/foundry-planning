// src/lib/reports/widgets/section-head.ts
//
// Registration glue for the sectionHead widget. Imported as a side effect
// from `src/lib/reports/widgets/index.ts`. Pure structural widget — no
// engine data, no scopes.

import { registerWidget } from "@/lib/reports/widget-registry";
import { SectionHeadRender } from "@/components/reports/widgets/section-head";
import { SectionHeadInspector } from "@/components/reports/widget-inspectors/section-head";

registerWidget({
  kind: "sectionHead",
  category: "Structure",
  label: "Section Head",
  description: "Eyebrow label + large serif title. Splits a page into sections.",
  allowedRowSizes: ["1-up"],
  defaultProps: { eyebrow: "01", title: "Section" },
  Render: SectionHeadRender,
  Inspector: SectionHeadInspector,
});
