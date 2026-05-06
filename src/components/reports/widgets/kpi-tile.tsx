// src/components/reports/widgets/kpi-tile.tsx
//
// Screen render for the kpiTile widget. Shown on the canvas in builder
// preview and on the screen-mode of the rendered report. The PDF render
// lives at `components/reports-pdf/widgets/kpi-tile.tsx` and is wired
// onto the registry entry by `lib/reports/widgets/kpi-tile.pdf.ts`,
// which only loads in the server bundle — keeping
// `@react-pdf/renderer` out of the client builder bundle.
//
// Visual treatment matches the Ethos comparison redesign:
// - Cream/light card (`bg-report-card` + `border-report-hair`) so the
//   builder canvas reads the same as the printed PDF, even though the
//   surrounding app shell is dark.
// - 2px top accent rule colored by the optional `accentColor` prop
//   (defaults to "accent" — Foundry gold).
// - Mono uppercase label (category from metric registry) → large value
//   → optional title + subtitle → optional delta line.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { getMetric, formatMetric } from "@/lib/reports/metric-registry";
import { REPORT_THEME } from "@/lib/reports/theme";

export function KpiTileRender({ props, data }: WidgetRenderProps<"kpiTile">) {
  const metric = getMetric(props.metricKey);
  const d = data as { value: number | null; prevValue?: number | null };
  const value = d?.value ?? null;
  const prev = d?.prevValue ?? null;
  const delta = props.showDelta && value !== null && prev != null ? value - prev : null;
  const title = props.titleOverride || metric.label;
  const accentKey = props.accentColor ?? "accent";
  const accentColor = REPORT_THEME.categoryColors[accentKey];

  return (
    <div
      className="bg-report-card rounded-md border border-report-hair h-full overflow-hidden"
      style={{ borderTop: `2px solid ${accentColor}` }}
    >
      <div className="p-5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-report-ink-2 mb-2">
          {metric.category}
        </div>
        <div className="text-3xl font-medium text-report-ink leading-tight">
          {formatMetric(value, metric.format)}
        </div>
        <div className="text-sm text-report-ink-2 mt-1">{title}</div>
        {props.subtitle && (
          <div className="text-xs text-report-ink-3 mt-0.5">{props.subtitle}</div>
        )}
        {delta != null && (
          <div
            className={`text-[11px] font-mono mt-3 ${
              delta >= 0 ? "text-report-good" : "text-report-crit"
            }`}
          >
            {delta >= 0 ? "+" : ""}
            {formatMetric(delta, metric.format)} vs last yr
          </div>
        )}
      </div>
    </div>
  );
}
