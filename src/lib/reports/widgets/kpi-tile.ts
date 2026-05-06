// src/lib/reports/widgets/kpi-tile.ts
//
// Registration glue for the kpiTile widget. Imported as a side effect
// from `src/lib/reports/widgets/index.ts`, which is in turn imported by
// the builder so `registerWidget` runs before the reducer's `makeWidget`.

import { registerWidget } from "@/lib/reports/widget-registry";
import { KpiTileRender } from "@/components/reports/widgets/kpi-tile";
import { KpiTileInspector } from "@/components/reports/widget-inspectors/kpi-tile";

registerWidget({
  kind: "kpiTile",
  category: "KPI",
  label: "KPI Tile",
  description: "One key metric: label, formatted value, optional delta vs prior year.",
  allowedRowSizes: ["2-up", "3-up", "4-up"],
  defaultProps: { metricKey: "netWorthNow", showDelta: false },
  Render: KpiTileRender,
  Inspector: KpiTileInspector,
});
