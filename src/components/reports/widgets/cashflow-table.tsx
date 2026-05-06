// src/components/reports/widgets/cashflow-table.tsx
//
// Screen render for the cashflowTable widget. Renders an HTML table of
// year-by-year income / expenses / savings / net values, scoped from the
// shared `cashflow` scope (same loader branch as cashflowBarChart).
//
// Visual treatment matches the Ethos comparison redesign branded table:
// cream/light card, dark header row with mono uppercase labels, zebra
// rows alternating `report-card`/`report-zebra`, hairline separators,
// right-aligned numeric cells (year column left-aligned), and a 1.5px
// accent separator above the optional totals row.
//
// PDF render lives at `components/reports-pdf/widgets/cashflow-table.tsx`
// and is attached to the registry entry by
// `lib/reports/widgets/cashflow-table.pdf.ts`, which only loads in the
// server bundle. This component intentionally avoids importing
// `@react-pdf/renderer` so the client builder bundle stays small.

import { useMemo } from "react";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import {
  totalIncome,
  type CashflowScopeData,
} from "@/lib/reports/scopes/cashflow";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { useReportContext } from "../builder-context";

const FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function CashflowTableRender(p: WidgetRenderProps<"cashflowTable">) {
  const ctx = useReportContext();
  const range = resolveYearRange(p.props.yearRange, ctx.household);
  const d = (p.data as { cashflow?: CashflowScopeData })?.cashflow;

  // Memoize derived rows + totals — inspector keystrokes re-render this
  // widget often, no reason to recompute on every keystroke.
  const { rows, totals } = useMemo(() => {
    const filtered = (d?.years ?? []).filter(
      (y) => y.year >= range.from && y.year <= range.to,
    );
    const t = filtered.reduce(
      (a, r) => ({
        income: a.income + totalIncome(r),
        expenses: a.expenses + r.expenses,
        savings: a.savings + r.savings,
      }),
      { income: 0, expenses: 0, savings: 0 },
    );
    return { rows: filtered, totals: t };
  }, [d?.years, range.from, range.to]);

  return (
    <div className="bg-report-card rounded-md border border-report-hair overflow-hidden">
      <div className="p-4 pb-3">
        <div className="text-base font-medium text-report-ink">
          {p.props.title}
        </div>
        {p.props.subtitle && (
          <div className="text-xs text-report-ink-3 mt-1">
            {p.props.subtitle}
          </div>
        )}
      </div>
      <table className="w-full text-[12px] font-mono border-collapse">
        <caption className="sr-only">{p.props.title}</caption>
        <thead>
          <tr className="bg-report-ink-deep text-report-ink-on-dark">
            <th
              scope="col"
              className="text-left text-[9px] uppercase tracking-wider font-medium px-3 py-2"
            >
              Year
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-3 py-2"
            >
              Income
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-3 py-2"
            >
              Expenses
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-3 py-2"
            >
              Savings
            </th>
            <th
              scope="col"
              className="text-right text-[9px] uppercase tracking-wider font-medium px-3 py-2"
            >
              Net
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.year}
              className={`${i % 2 === 0 ? "bg-report-card" : "bg-report-zebra"} border-t border-report-hair`}
            >
              <td className="px-3 py-2 text-left text-report-ink">{r.year}</td>
              <td className="px-3 py-2 text-right text-report-ink">
                {FMT.format(totalIncome(r))}
              </td>
              <td className="px-3 py-2 text-right text-report-ink">
                {FMT.format(r.expenses)}
              </td>
              <td className="px-3 py-2 text-right text-report-ink">
                {FMT.format(r.savings)}
              </td>
              <td
                className={`px-3 py-2 text-right ${r.net >= 0 ? "text-report-good" : "text-report-crit"}`}
              >
                {FMT.format(r.net)}
              </td>
            </tr>
          ))}
          {p.props.showTotals && (
            <tr
              className="bg-report-card font-medium"
              style={{ borderTop: "1.5px solid var(--color-report-accent)" }}
            >
              <td className="px-3 py-2.5 text-left text-report-ink">Total</td>
              <td className="px-3 py-2.5 text-right text-report-ink">
                {FMT.format(totals.income)}
              </td>
              <td className="px-3 py-2.5 text-right text-report-ink">
                {FMT.format(totals.expenses)}
              </td>
              <td className="px-3 py-2.5 text-right text-report-ink">
                {FMT.format(totals.savings)}
              </td>
              {/* Net total is "—": engine's per-year `net` doesn't sum cleanly across years. */}
              <td className="px-3 py-2.5 text-right text-report-ink">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
