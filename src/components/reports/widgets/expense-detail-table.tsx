// src/components/reports/widgets/expense-detail-table.tsx
//
// Screen render for the expenseDetailTable widget. Reads year-by-year
// expense totals from the cashflow scope and renders them as a branded
// table mirroring the cashflowTable treatment.
//
// V1: flat "Year / Annual Expense" rows. The `groupByCategory` prop is
// reserved — surfacing per-category expense breakdown requires engine
// category-attribution work (see future-work/reports.md). When the toggle
// is off (always, in v1) the render flows as a simple two-column table.
//
// PDF render lives at `components/reports-pdf/widgets/expense-detail-table.tsx`.

import { useMemo } from "react";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { useReportContext } from "../builder-context";
import { fmtCurrency } from "./chart-shared";

export function ExpenseDetailTableRender(
  p: WidgetRenderProps<"expenseDetailTable">,
) {
  const ctx = useReportContext();
  const range = resolveYearRange(p.props.yearRange, ctx.household);
  const d = (p.data as { cashflow?: CashflowScopeData })?.cashflow;

  const rows = useMemo(() => {
    return (d?.years ?? []).filter(
      (y) => y.year >= range.from && y.year <= range.to,
    );
  }, [d?.years, range.from, range.to]);

  const total = rows.reduce((s, r) => s + r.expenses, 0);

  return (
    <div className="bg-report-card rounded-md border border-report-hair overflow-hidden">
      <div className="p-4 pb-3">
        <div className="text-base font-medium text-report-ink">
          {p.props.title}
        </div>
      </div>
      <table className="w-full text-[12px] font-mono border-collapse">
        <caption className="sr-only">{p.props.title}</caption>
        <thead>
          <tr className="bg-report-ink-deep text-report-ink-on-dark">
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Year
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-4 py-2"
            >
              Annual Expense
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-report-hair">
              <td
                colSpan={2}
                className="px-4 py-4 text-xs text-report-ink-3 italic text-center"
              >
                No expense data — preview shown only at export.
              </td>
            </tr>
          ) : (
            <>
              {rows.map((r, i) => (
                <tr
                  key={r.year}
                  className={`${i % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
                >
                  <td className="px-4 py-2 text-left text-report-ink">
                    {r.year}
                  </td>
                  <td className="px-4 py-2 text-right text-report-ink">
                    {fmtCurrency.format(r.expenses)}
                  </td>
                </tr>
              ))}
              <tr
                className="bg-report-card font-medium"
                style={{ borderTop: "1.5px solid var(--color-report-accent)" }}
              >
                <td className="px-4 py-2.5 text-left text-report-ink">Total</td>
                <td className="px-4 py-2.5 text-right text-report-ink">
                  {fmtCurrency.format(total)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
