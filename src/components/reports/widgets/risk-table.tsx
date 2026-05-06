// src/components/reports/widgets/risk-table.tsx
//
// Screen render for the riskTable widget. Branded table matching the
// polished `balanceSheetTable` / `recommendedChangesTable` treatment
// (cream/light card, dark header row, zebra-striped body rows, hairline
// separators).
//
// Three columns: Risk Area / Description / Severity. The severity cell
// renders a colored filled pill — small uppercase mono label inside a
// rounded rect, painted with the severity color from the design system.
//
// Severity → color mapping (single source of truth, mirrored in the PDF
// render): low → `report-good`, medium → `report-accent`,
// high → `report-crit`. All colors flow through `report-*` design
// tokens; no inlined hex.
//
// PDF render lives at `components/reports-pdf/widgets/risk-table.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { RiskSeverity } from "@/lib/reports/types";

const SEVERITY_BG: Record<RiskSeverity, string> = {
  low: "bg-report-good",
  medium: "bg-report-accent",
  high: "bg-report-crit",
};

export function RiskTableRender({ props }: WidgetRenderProps<"riskTable">) {
  const { title, rows } = props;

  return (
    <div className="bg-report-card rounded-md border border-report-hair overflow-hidden">
      {title && (
        <div className="p-4 pb-3">
          <div className="text-base font-medium text-report-ink">{title}</div>
        </div>
      )}
      <table className="w-full text-[12px] font-mono border-collapse">
        <caption className="sr-only">{title ?? "Identified risks"}</caption>
        <thead>
          <tr className="bg-report-ink-deep text-report-ink-on-dark">
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Risk Area
            </th>
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Description
            </th>
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2 w-24"
            >
              Severity
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="bg-report-card border-t border-report-hair">
              <td
                colSpan={3}
                className="px-4 py-3 text-report-ink-3 italic"
              >
                No risks identified.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className={`${i % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
              >
                <td className="px-4 py-2 text-report-ink font-medium">
                  {row.area}
                </td>
                <td className="px-4 py-2 text-report-ink">
                  {row.description}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`${SEVERITY_BG[row.severity]} text-report-ink-on-dark inline-block px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-medium`}
                  >
                    {row.severity}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
