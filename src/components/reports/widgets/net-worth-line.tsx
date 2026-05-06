// src/components/reports/widgets/net-worth-line.tsx
//
// Screen render for the netWorthLine widget. Chart.js Line of net worth over
// time, scoped from `balance`. The PDF render is a native @react-pdf/renderer
// SVG chart that consumes the same scope data — no canvas snapshot.
//
// `compareScenarioId` is wired into the inspector but resolves to `null` in
// v1 — the secondary trajectory will land with the scenario-comparison
// feature. Single-line render only, for now.
//
// PDF render lives at `components/reports-pdf/widgets/net-worth-line.tsx`
// and is attached to the registry entry by
// `lib/reports/widgets/net-worth-line.pdf.ts`, which only loads in the
// server bundle — keeping `@react-pdf/renderer` out of the client bundle
// and (symmetrically) keeping `chart.js` / `react-chartjs-2` out of the
// PDF bundle.

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { BalanceScopeData } from "@/lib/reports/scopes/balance";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { useReportContext } from "../builder-context";

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

export function NetWorthLineRender(p: WidgetRenderProps<"netWorthLine">) {
  const ctx = useReportContext();
  const range = resolveYearRange(p.props.yearRange, ctx.household);
  const d = (p.data as { balance?: BalanceScopeData })?.balance;
  const years = (d?.years ?? []).filter(
    (y) => y.year >= range.from && y.year <= range.to,
  );

  // Memoize the Chart.js inputs — Chart.js does identity comparison and
  // re-animates on every parent re-render. Inspector keystrokes shouldn't
  // thrash the chart.
  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: [
        {
          label: "Net worth",
          data: years.map((y) => y.netWorth),
          borderColor: "#3461a8",
          backgroundColor: "#3461a8",
          pointRadius: p.props.showMarkers ? 3 : 0,
          tension: 0.15,
        },
      ],
    }),
    [years, p.props.showMarkers],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        y: { grid: { display: p.props.showGrid } },
      },
    }),
    [p.props.showGrid],
  );

  return (
    <div className="p-4 bg-card-2 rounded-md border border-hair">
      <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
      {p.props.subtitle && (
        <div className="text-[12px] text-ink-3 mb-2">{p.props.subtitle}</div>
      )}
      <div style={{ height: 280 }}>
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
