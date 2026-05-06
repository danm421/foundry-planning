// src/lib/reports/widgets/life-phases-table.ts
//
// Screen-side registration glue for the lifePhasesTable widget. A
// hand-edited branded table with rows: Phase / Years / Ages. No engine
// data — the rows are advisor-curated narrative content.
//
// PDF renderer attached separately by `life-phases-table.pdf.ts` (loaded
// only by the server-only barrel `index.pdf.ts`).

import { registerWidget } from "@/lib/reports/widget-registry";
import { LifePhasesTableRender } from "@/components/reports/widgets/life-phases-table";
import { LifePhasesTableInspector } from "@/components/reports/widget-inspectors/life-phases-table";

registerWidget({
  kind: "lifePhasesTable",
  category: "Data Table",
  label: "Life Phases Table",
  description: "Phase / Years / Ages — manually edited rows.",
  allowedRowSizes: ["1-up", "2-up", "3-up", "4-up"],
  scopes: [],
  defaultProps: {
    title: "Life Phases",
    rows: [
      { phase: "Working years", years: "2026–2034", ages: "55–63" },
      { phase: "Early retirement", years: "2035–2049", ages: "64–78" },
      { phase: "Late retirement", years: "2050+", ages: "79+" },
    ],
  },
  Render: LifePhasesTableRender,
  Inspector: LifePhasesTableInspector,
});
