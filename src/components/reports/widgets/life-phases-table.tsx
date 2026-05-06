// src/components/reports/widgets/life-phases-table.tsx
//
// Screen render for the lifePhasesTable widget. Branded table mirroring
// the cashflow/balance-sheet pattern: cream/light bordered card,
// subsection-styled title, dark header row with mono uppercase labels,
// zebra rows alternating `report-card`/`report-zebra`, hairline
// separators.
//
// All columns are left-aligned (free-text strings — no numeric data).
//
// PDF render lives at `components/reports-pdf/widgets/life-phases-table.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function LifePhasesTableRender({
  props,
}: WidgetRenderProps<"lifePhasesTable">) {
  const rows = props.rows ?? [];
  return (
    <div className="bg-report-card rounded-md border border-report-hair overflow-hidden">
      {props.title && (
        <div className="p-4 pb-3">
          <div className="text-base font-medium text-report-ink">
            {props.title}
          </div>
        </div>
      )}
      <table className="w-full text-[12px] font-mono border-collapse">
        <caption className="sr-only">{props.title ?? "Life phases"}</caption>
        <thead>
          <tr className="bg-report-ink-deep text-report-ink-on-dark">
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Phase
            </th>
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Years
            </th>
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Ages
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-report-hair">
              <td
                colSpan={3}
                className="px-4 py-4 text-xs text-report-ink-3 italic text-center"
              >
                No phases — add rows in the inspector.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr
                key={i}
                className={`${i % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
              >
                <td className="px-4 py-2 text-report-ink">{r.phase}</td>
                <td className="px-4 py-2 text-report-ink">{r.years}</td>
                <td className="px-4 py-2 text-report-ink">{r.ages}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
