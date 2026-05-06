// src/components/reports/widgets/allocation-donut.tsx
//
// Screen render for the allocationDonut widget. Chart.js Doughnut of the
// current-year asset-class breakdown, scoped from `allocation`. The PDF
// render is a native @react-pdf/renderer SVG donut that consumes the same
// scope data — no canvas snapshot.
//
// Visual parity with the PDF render: same palette
// (`REPORT_THEME.chartPalette`), donut on the left, legend on the right
// with colored swatch + label + percentage, and a center label showing
// the total dollar value.
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
  type Plugin,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { AllocationScopeData } from "@/lib/reports/scopes/allocation";
import { REPORT_THEME } from "@/lib/reports/theme";
import { fmtCompactDollar } from "./chart-shared";

ChartJS.register(ArcElement, DoughnutController, Tooltip, Legend);

const PALETTE = REPORT_THEME.chartPalette;
const C = REPORT_THEME.colors;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

// Center-total plugin — draws the dollar total in the donut hole. Mirrors
// the PDF widget's center-label affordance.
function makeCenterLabelPlugin(total: number): Plugin<"doughnut"> {
  return {
    id: "donutCenterLabel",
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta?.data || meta.data.length === 0) return;
      const arc = meta.data[0] as unknown as { x: number; y: number };
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = C.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 16px Inter, system-ui, sans-serif`;
      ctx.fillText(fmtCompactDollar(total), arc.x, arc.y - 6);
      ctx.fillStyle = C.ink2;
      ctx.font = `9px ${MONO_FONT}`;
      ctx.fillText("TOTAL", arc.x, arc.y + 10);
      ctx.restore();
    },
  };
}

export function AllocationDonutRender(p: WidgetRenderProps<"allocationDonut">) {
  const d = (p.data as { allocation?: AllocationScopeData })?.allocation;
  // Stable identity for the empty fallback so the useMemo dep below doesn't
  // flip on every render when scope data is missing. Resolving inside the
  // hook would also work, but pulling it to a single ?? expression keeps the
  // dependency a single value rather than `(d?.allocation as ...)`.
  const byClass = useMemo(() => d?.byClass ?? [], [d?.byClass]);

  const total = useMemo(
    () => byClass.reduce((sum, c) => sum + c.value, 0),
    [byClass],
  );

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
        // We render our own legend on the right (with %), not Chart.js's.
        legend: { display: false },
        tooltip: {
          titleFont: { family: MONO_FONT, size: 10 },
          bodyFont: { family: MONO_FONT, size: 10 },
          callbacks: {
            label: (item: { label?: string; parsed: number }) => {
              const pct = total > 0 ? (item.parsed / total) * 100 : 0;
              return `${item.label ?? ""}: ${fmtCompactDollar(item.parsed)} (${pct.toFixed(1)}%)`;
            },
          },
        },
      },
      cutout: "62%",
    }),
    [total],
  );

  const centerPlugin = useMemo(() => makeCenterLabelPlugin(total), [total]);

  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      <div className="text-base font-serif font-medium text-report-ink mb-1">
        {p.props.title}
      </div>
      {p.props.subtitle && (
        <div className="text-xs text-report-ink-3 mb-3">{p.props.subtitle}</div>
      )}
      <div className="flex items-center gap-4" style={{ height: 280 }}>
        <div className="flex-1 h-full min-w-0">
          <Doughnut data={data} options={options} plugins={[centerPlugin]} />
        </div>
        {p.props.showLegend && (
          <ul className="flex-shrink-0 flex flex-col gap-2 max-w-[40%] min-w-0 text-xs">
            {byClass.map((c, i) => {
              const pct = total > 0 ? (c.value / total) * 100 : 0;
              return (
                <li
                  key={c.className}
                  className="flex items-center gap-2 text-report-ink-2"
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-[1px] flex-shrink-0"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="truncate text-report-ink">{c.className}</span>
                  <span
                    className="ml-auto text-report-ink-3 tabular-nums"
                    style={{ fontFamily: MONO_FONT, fontSize: 10 }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
