// src/components/reports/widgets/allocation-donut.tsx
//
// Screen render for the allocationDonut widget. Chart.js Doughnut of the
// current-year asset-class breakdown, scoped from `allocation`. The PDF
// render is a native @react-pdf/renderer SVG donut that consumes the same
// scope data — no canvas snapshot.
//
// `props.innerRingAssetType` is wired into the inspector but is a no-op in
// v1 — the engine doesn't expose asset-type allocation (stocks vs bonds vs
// cash equivalents) at the year level. The inspector toggle is labeled
// "coming soon" so users don't expect a second ring to appear. See
// future-work/engine.md → Foundry Reports v1 follow-ups.
//
// PDF render lives at `components/reports-pdf/widgets/allocation-donut.tsx`
// and is attached to the registry entry by
// `lib/reports/widgets/allocation-donut.pdf.ts`, which only loads in the
// server bundle — keeping `@react-pdf/renderer` out of the client bundle
// and (symmetrically) keeping `chart.js` / `react-chartjs-2` out of the
// PDF bundle.

import { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { AllocationScopeData } from "@/lib/reports/scopes/allocation";

ChartJS.register(ArcElement, DoughnutController, Tooltip, Legend);

// Matches the cashflow-bar-chart palette intentionally — both charts are
// often shown on the same page. Future-work item: extract a shared
// CHART_PALETTE constant once a third widget needs it.
const PALETTE = [
  "#b87f1f",
  "#2f6b4a",
  "#3461a8",
  "#7a4ea3",
  "#a13a3a",
  "#5a5a60",
];

export function AllocationDonutRender(p: WidgetRenderProps<"allocationDonut">) {
  const d = (p.data as { allocation?: AllocationScopeData })?.allocation;
  // Stable identity for the empty fallback so the useMemo dep below doesn't
  // flip on every render when scope data is missing. Resolving inside the
  // hook would also work, but pulling it to a single ?? expression keeps the
  // dependency a single value rather than `(d?.allocation as ...)`.
  const byClass = useMemo(() => d?.byClass ?? [], [d?.byClass]);

  // Memoize the Chart.js inputs — Chart.js does identity comparison and
  // re-animates on every parent re-render. Inspector keystrokes shouldn't
  // thrash the chart.
  const data = useMemo(
    () => ({
      labels: byClass.map((c) => c.className),
      datasets: [
        {
          data: byClass.map((c) => c.value),
          backgroundColor: byClass.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 0,
        },
      ],
    }),
    [byClass],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: p.props.showLegend, position: "right" as const },
      },
      cutout: "60%",
    }),
    [p.props.showLegend],
  );

  return (
    <div className="p-4 bg-card-2 rounded-md border border-hair">
      <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
      {p.props.subtitle && (
        <div className="text-[12px] text-ink-3 mb-2">{p.props.subtitle}</div>
      )}
      <div style={{ height: 280 }}>
        <Doughnut data={data} options={options} />
      </div>
    </div>
  );
}
