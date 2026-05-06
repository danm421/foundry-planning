// src/lib/reports/widgets/allocation-donut.ts
//
// Screen-side registration glue for the allocationDonut widget. Imported
// as a side effect from `src/lib/reports/widgets/index.ts`, which is in
// turn imported by the builder so `registerWidget` runs before the
// reducer's `makeWidget`.
//
// The PDF renderer is attached separately by `allocation-donut.pdf.ts`
// (loaded only by the server-only barrel `index.pdf.ts`) so the
// `@react-pdf/renderer` runtime never reaches the client builder bundle.

import { registerWidget } from "@/lib/reports/widget-registry";
import { AllocationDonutRender } from "@/components/reports/widgets/allocation-donut";
import { AllocationDonutInspector } from "@/components/reports/widget-inspectors/allocation-donut";

registerWidget({
  kind: "allocationDonut",
  category: "Chart",
  label: "Allocation",
  description: "Asset-class allocation donut.",
  allowedRowSizes: ["2-up", "3-up"],
  scopes: ["allocation"],
  defaultProps: {
    title: "Allocation",
    asOfYear: "current",
    innerRingAssetType: false,
    showLegend: true,
  },
  Render: AllocationDonutRender,
  Inspector: AllocationDonutInspector,
});
