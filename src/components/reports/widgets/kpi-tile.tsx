// src/components/reports/widgets/kpi-tile.tsx
//
// Screen render for the kpiTile widget. Shown on the canvas in builder
// preview and on the screen-mode of the rendered report. PDF render is
// the same component path with `mode === "pdf"`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { getMetric, formatMetric } from "@/lib/reports/metric-registry";

export function KpiTileRender({ props, data, mode }: WidgetRenderProps<"kpiTile">) {
  const metric = getMetric(props.metricKey);
  const d = data as { value: number | null; prevValue?: number | null };
  const value = d?.value ?? null;
  const prev = d?.prevValue ?? null;
  const delta = props.showDelta && value !== null && prev != null ? value - prev : null;
  const title = props.titleOverride || metric.label;
  return (
    <div className={`p-5 ${mode === "pdf" ? "bg-white" : "bg-card-2"} rounded-md border border-hair h-full`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3 mb-1">
        {metric.category}
      </div>
      <div className="text-[28px] font-semibold text-ink leading-tight">
        {formatMetric(value, metric.format)}
      </div>
      <div className="text-[12px] text-ink-3 mt-1">{title}</div>
      {props.subtitle && <div className="text-[11px] text-ink-3 mt-0.5">{props.subtitle}</div>}
      {delta != null && (
        <div className={`text-[11px] font-mono mt-2 ${delta >= 0 ? "text-good" : "text-crit"}`}>
          {delta >= 0 ? "+" : ""}{formatMetric(delta, metric.format)} vs last yr
        </div>
      )}
    </div>
  );
}
