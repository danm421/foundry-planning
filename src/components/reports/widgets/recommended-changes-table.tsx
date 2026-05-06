// src/components/reports/widgets/recommended-changes-table.tsx
//
// Screen render for the recommendedChangesTable widget. Branded table
// matching the polished `balanceSheetTable` treatment (cream/light card,
// dark header row, zebra-striped body rows, hairline separators).
//
// Two layouts driven by `props.variant`:
//   - "list"             → single "Change" column (executive summary)
//   - "currentVsProposed" → 3 columns: "Change / Current / Proposed"
//
// Each "change" cell is prefixed with a green checkmark to signal that
// the row is a recommended improvement. Rows are sourced directly from
// `props.rows` — the widget does NOT consume the comparison scope; v1 is
// hand-edited by the advisor through the inspector. (Auto-derivation
// from the comparison scope is logged in future-work/reports.md.)
//
// PDF render lives at `components/reports-pdf/widgets/recommended-changes-table.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function RecommendedChangesTableRender({
  props,
}: WidgetRenderProps<"recommendedChangesTable">) {
  const { title, variant, rows } = props;
  const isCurrentVsProposed = variant === "currentVsProposed";

  return (
    <div className="bg-report-card rounded-md border border-report-hair overflow-hidden">
      {title && (
        <div className="p-4 pb-3">
          <div className="text-base font-medium text-report-ink">{title}</div>
        </div>
      )}
      <table className="w-full text-[12px] font-mono border-collapse">
        <caption className="sr-only">{title ?? "Recommended changes"}</caption>
        <thead>
          <tr className="bg-report-ink-deep text-report-ink-on-dark">
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Change
            </th>
            {isCurrentVsProposed && (
              <>
                <th
                  scope="col"
                  className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
                >
                  Current
                </th>
                <th
                  scope="col"
                  className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
                >
                  Proposed
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="bg-report-card border-t border-report-hair">
              <td
                colSpan={isCurrentVsProposed ? 3 : 1}
                className="px-4 py-3 text-report-ink-3 italic"
              >
                No recommended changes.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className={`${i % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
              >
                <td className="px-4 py-2 text-report-ink">
                  <span className="text-report-good mr-2" aria-hidden="true">
                    ✓
                  </span>
                  {row.change}
                </td>
                {isCurrentVsProposed && (
                  <>
                    <td className="px-4 py-2 text-report-ink">
                      {row.current ?? ""}
                    </td>
                    <td className="px-4 py-2 text-report-ink">
                      {row.proposed ?? ""}
                    </td>
                  </>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
