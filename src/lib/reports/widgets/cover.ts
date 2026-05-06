// src/lib/reports/widgets/cover.ts
//
// Registration glue for the cover widget. Imported as a side effect
// from `src/lib/reports/widgets/index.ts`, which is in turn imported by
// the builder so `registerWidget` runs before the reducer's `makeWidget`.
//
// `ownsPage: true` is what the reducer guards on — see ADD_WIDGET_TO_SLOT
// / REPLACE_WIDGET in `lib/reports/reducer.ts`. The PDF render is wired
// onto this entry by `cover.pdf.ts`, server-only.

import { registerWidget } from "@/lib/reports/widget-registry";
import { CoverRender } from "@/components/reports/widgets/cover";
import { CoverInspector } from "@/components/reports/widget-inspectors/cover";

registerWidget({
  kind: "cover",
  category: "Cover",
  label: "Cover",
  description: "Title, subtitle, year, advisor mark.",
  allowedRowSizes: ["1-up"],
  ownsPage: true,
  defaultProps: { title: "Annual Review", year: new Date().getFullYear() },
  Render: CoverRender,
  Inspector: CoverInspector,
});
