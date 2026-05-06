// src/components/reports/widgets/comparison-donut-pair.tsx
//
// Screen render for the comparisonDonutPair widget. Two donut charts
// side-by-side — "Current" left, "Proposed" right — using the same
// composition as `allocationDonut` (one slice per asset class, palette
// from `REPORT_THEME.chartPalette`). Shared legend below; each donut
// shows a center total. Reads `comparison.current.allocation` and
// `comparison.proposed.allocation` from the data-loader-stamped
// `widgetData[id]`.
//
// `props.asOfYear` is wired but currently a no-op — the underlying
// allocation scope only exposes the first-year allocation. Symmetric
// with the single `allocationDonut` widget; both will pick up
// year-targeted allocation when the engine surfaces it.

import { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";
import {
  ArcElement,
  Chart as ChartJS,
  DoughnutController,
  Legend,
  Tooltip,
  type Plugin,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { ComparisonScopeData } from "@/lib/reports/scopes/comparison";
import type { AllocationScopeData } from "@/lib/reports/scopes/allocation";
import { REPORT_THEME } from "@/lib/reports/theme";
import { fmtCompactDollar } from "./chart-shared";

ChartJS.register(ArcElement, DoughnutController, Tooltip, Legend);

const PALETTE = REPORT_THEME.chartPalette;
const C = REPORT_THEME.colors;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

type CompPayload = { comparison?: ComparisonScopeData } | null | undefined;

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
      ctx.font = `600 14px Inter, system-ui, sans-serif`;
      ctx.fillText(fmtCompactDollar(total), arc.x, arc.y - 6);
      ctx.fillStyle = C.ink2;
      ctx.font = `8px ${MONO_FONT}`;
      ctx.fillText("TOTAL", arc.x, arc.y + 8);
      ctx.restore();
    },
  };
}

function SideDonut({
  label,
  allocation,
}: {
  label: string;
  allocation: AllocationScopeData;
}) {
  const byClass = allocation.byClass;
  const total = useMemo(
    () => byClass.reduce((sum, c) => sum + c.value, 0),
    [byClass],
  );

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
    <div className="flex-1 flex flex-col items-center min-w-0">
      <div
        className="text-[11px] font-mono uppercase tracking-wider text-report-ink-3 mb-1"
      >
        {label}
      </div>
      <div className="w-full" style={{ height: 220 }}>
        {byClass.length === 0 ? (
          <div className="h-full flex items-center justify-center text-report-ink-3 text-xs">
            No data
          </div>
        ) : (
          <Doughnut data={data} options={options} plugins={[centerPlugin]} />
        )}
      </div>
    </div>
  );
}

export function ComparisonDonutPairRender(
  p: WidgetRenderProps<"comparisonDonutPair">,
) {
  const comparison = (p.data as CompPayload)?.comparison;
  if (!comparison) {
    return <EmptyState title={p.props.title} />;
  }
  return (
    <DonutPairCard
      title={p.props.title}
      subtitle={p.props.subtitle}
      showLegend={p.props.showLegend}
      comparison={comparison}
    />
  );
}

function DonutPairCard({
  title,
  subtitle,
  showLegend,
  comparison,
}: {
  title: string;
  subtitle?: string;
  showLegend: boolean;
  comparison: ComparisonScopeData;
}) {
  // Combine both sides' classNames into a single ordered legend so the swatches
  // stay aligned with the per-side ordering. Slice 0 of each donut shares the
  // same color across donuts because both sides walk the engine's category
  // order; we just dedupe by className for the shared legend. Plain locals
  // — React 19 + the React Compiler memoizes for us.
  const seen = new Map<string, number>();
  const all = [
    ...comparison.current.allocation.byClass,
    ...comparison.proposed.allocation.byClass,
  ];
  all.forEach((c, i) => {
    if (!seen.has(c.className)) seen.set(c.className, i);
  });
  const sharedLegend = [...seen.entries()].map(([className, idx]) => ({
    className,
    color: PALETTE[idx % PALETTE.length],
  }));

  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      <div className="text-base font-serif font-medium text-report-ink mb-1">
        {title}
      </div>
      {subtitle && (
        <div className="text-xs text-report-ink-3 mb-3">{subtitle}</div>
      )}
      <div className="flex gap-4">
        <SideDonut
          label="Current"
          allocation={comparison.current.allocation}
        />
        <SideDonut
          label="Proposed"
          allocation={comparison.proposed.allocation}
        />
      </div>
      {showLegend && sharedLegend.length > 0 && (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 justify-center text-xs text-report-ink-2">
          {sharedLegend.map((it) => (
            <li key={it.className} className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-[1px]"
                style={{ backgroundColor: it.color }}
              />
              <span>{it.className}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="bg-report-card border border-report-hair rounded-md p-6 text-center text-report-ink-3">
      <div className="text-base font-serif font-medium text-report-ink mb-2">
        {title}
      </div>
      <div className="text-xs">Bind two scenarios to use this widget.</div>
    </div>
  );
}
