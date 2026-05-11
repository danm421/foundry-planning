// src/components/reports/widgets/cashflow-table.tsx
//
// Screen render for the cashflowTable widget. Renders an HTML table of
// year-by-year income / expenses / savings / net values, scoped from the
// shared `cashflow` scope (same loader branch as cashflowBarChart).
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
    <div className="p-4 bg-card-2 rounded-md border border-hair">
      <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
      {p.props.subtitle && (
        <div className="text-[12px] text-ink-3 mb-2">{p.props.subtitle}</div>
      )}
      <table className="w-full text-[12px] font-mono">
        <caption className="sr-only">{p.props.title}</caption>
        <thead>
          <tr className="text-ink-3 text-left">
            <th scope="col">Year</th>
            <th scope="col">Income</th>
            <th scope="col">Expenses</th>
            <th scope="col">Savings</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-t border-hair hover:[&>td]:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff]">
              <td>{r.year}</td>
              <td>{FMT.format(totalIncome(r))}</td>
              <td>{FMT.format(r.expenses)}</td>
              <td>{FMT.format(r.savings)}</td>
              <td className={r.net >= 0 ? "text-good" : "text-crit"}>
                {FMT.format(r.net)}
              </td>
            </tr>
          ))}
          {p.props.showTotals && (
            <tr className="border-t-2 border-ink font-medium">
              <td>Total</td>
              <td>{FMT.format(totals.income)}</td>
              <td>{FMT.format(totals.expenses)}</td>
              <td>{FMT.format(totals.savings)}</td>
              {/* Net total is "—": engine's per-year `net` doesn't sum cleanly across years. */}
              <td>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
