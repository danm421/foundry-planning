"use client";

import { memo, useMemo } from "react";
import { TaxDetailTooltip } from "@/components/cashflow/tax-detail-tooltip";
import { formatProjectionAges } from "@/components/cashflow/projection-ages";
import {
  activeWithdrawalSources,
  type WithdrawalReportRow,
} from "@/lib/solver/withdrawal-report";

interface Props {
  rows: WithdrawalReportRow[];
  /** Highlights the row for the year selected on the chart above. */
  selectedYear: number | null;
  onYearClick: (year: number) => void;
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
// Two decimals, matching the cash-flow report's Withdrawal % — at plan-level
// draw rates the difference between 3.7% and 3.75% is a real distinction.
const fmtPct = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// `accent-wash` is translucent by design, so it can't be the only background on
// a sticky cell — the columns scrolling underneath show straight through it.
// Paint it as a background *image* over the opaque card color instead.
const ROW_BG = "bg-card";
const ROW_BG_SELECTED =
  "bg-card bg-[linear-gradient(var(--color-accent-wash),var(--color-accent-wash))]";

interface Column {
  key: string;
  label: string;
  tooltip?: string;
  value: (r: WithdrawalReportRow) => number;
  /** Starts a new column group: draws the vertical rule to its left. */
  groupStart?: boolean;
  /** Red when negative. Only Net Cash Flow, where the sign is the message. */
  signed?: boolean;
  /** Percent columns are ratios, not dollars. */
  format?: "percent";
}

/**
 * Reads left to right as the year's cash story: what came in without touching
 * the portfolio, what the portfolio had to cover and from which tax treatment,
 * how hard that leaned on it, then what went out and what was left over.
 *
 * There is no all-zero column sweep here, unlike the cash-flow drill-downs:
 * every column below is a total, a reconciling figure, or a ratio whose zero is
 * itself the answer. The only columns that come and go are the per-source draws,
 * and `activeWithdrawalSources` has already dropped the ones never drawn on.
 */
function buildColumns(rows: WithdrawalReportRow[]): Column[] {
  const draws: Column[] = [
    ...activeWithdrawalSources(rows).map((source) => ({
      key: `wd_${source.key}`,
      label: source.label,
      tooltip: `Portfolio withdrawn from ${source.label.toLowerCase()} accounts to cover the year's shortfall.`,
      value: (r: WithdrawalReportRow) => r.withdrawals[source.key],
    })),
    {
      key: "withdrawalsTotal",
      label: "Total Withdrawals",
      tooltip:
        "Total drawn from the portfolio this year. In a deficit year this equals the negative Net Cash Flow — the withdrawal is what closes the gap.",
      value: (r) => r.withdrawalsTotal,
    },
    {
      // Shown beside the rate for the same reason the cash-flow drill-down
      // shows it: a ratio whose denominator is invisible can't be checked.
      key: "portfolioBoy",
      label: "Portfolio (BoY)",
      tooltip:
        "The liquid portfolio at the start of the year — last year's ending Portfolio Assets. Withdrawal % is measured against it.",
      value: (r) => r.portfolioBoy,
    },
    {
      key: "withdrawalRate",
      label: "Withdrawal %",
      tooltip:
        "Total Withdrawals plus RMDs, over Portfolio (BoY). RMDs leave the portfolio too, so in an RMD year this reads higher than Total Withdrawals alone would give.",
      value: (r) => r.withdrawalRate,
      format: "percent",
    },
  ];
  // The portfolio group opens at whichever draw column comes first: a plan that
  // never withdraws has no per-source columns to open it.
  draws[0].groupStart = true;

  return [
    {
      key: "totalIncome",
      label: "Total Income",
      tooltip:
        "Everything that funded the year without a portfolio withdrawal — Social Security, salaries, other income, and RMDs.",
      value: (r) => r.totalIncome,
    },
    ...draws,
    {
      key: "livingExpenses",
      label: "Living Expenses",
      tooltip: "The household's living expense need — the line on the chart above.",
      value: (r) => r.livingExpenses,
      groupStart: true,
    },
    {
      key: "totalExpenses",
      label: "Total Expenses",
      tooltip: "Living expenses plus liabilities, insurance, taxes, savings, and gifts.",
      value: (r) => r.totalExpenses,
    },
    {
      key: "netCashFlow",
      label: "Net Cash Flow",
      tooltip:
        "Total Income − Total Expenses. Negative years are funded by the withdrawals to the left.",
      value: (r) => r.netCashFlow,
      signed: true,
    },
  ];
}

// Memoized: unlike every other report tab's table this one is mounted at all
// times, so it would otherwise re-render ~70 rows × ~10 columns on every
// pointermove of the chart-height drag — which changes nothing above it. Every
// prop is stable across such a render (`rows` is the parent's useMemo,
// `onYearClick` is a setState).
export const SolverWithdrawalPanel = memo(function SolverWithdrawalPanel({
  rows,
  selectedYear,
  onYearClick,
  clientLifeExpectancy,
  spouseLifeExpectancy,
}: Props) {
  const columns = useMemo(() => buildColumns(rows), [rows]);

  if (rows.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-hair-2 bg-card-2 px-4 py-5 text-sm text-ink-2">
        No projection years to show.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-hair bg-card">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          Year-by-year portfolio withdrawals by source, the rate they draw the
          portfolio down at, and net cash flow
        </caption>
        <thead className="bg-card text-xs uppercase text-ink-3">
          <tr>
            <th className="sticky left-0 z-20 w-20 min-w-[5rem] border-b border-hair bg-card px-3 py-2 text-left">
              Year
            </th>
            <th className="sticky left-20 z-20 w-24 min-w-[6rem] border-b border-r border-hair bg-card px-3 py-2 text-left">
              Age
            </th>
            {columns.map((col, idx) => {
              const isLast = idx === columns.length - 1;
              return (
                <th
                  key={col.key}
                  className={`border-b border-hair bg-card px-3 py-2 text-right font-medium ${col.groupStart ? "border-l" : ""} ${isLast ? "sticky right-0 z-20 border-l" : ""}`}
                >
                  {col.tooltip ? (
                    <TaxDetailTooltip label={col.label} text={col.tooltip} />
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="text-ink">
          {rows.map((r) => {
            const selected = r.year === selectedYear;
            const rowBg = selected ? ROW_BG_SELECTED : ROW_BG;
            return (
              <tr key={r.year} className="group">
                <td
                  className={`sticky left-0 z-10 cursor-pointer border-b border-hair px-3 py-2 text-left hover:text-accent group-hover:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)] ${rowBg} ${selected ? "font-medium" : ""}`}
                  onClick={() => onYearClick(r.year)}
                  title={`Show ${r.year} in the year detail below`}
                >
                  {r.year}
                </td>
                <td
                  className={`sticky left-20 z-10 border-b border-r border-hair px-3 py-2 text-left text-ink-2 group-hover:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)] ${rowBg}`}
                >
                  {formatProjectionAges(r.ages, clientLifeExpectancy, spouseLifeExpectancy)}
                </td>
                {columns.map((col, idx) => {
                  const v = col.value(r);
                  const isLast = idx === columns.length - 1;
                  return (
                    <td
                      key={col.key}
                      className={`border-b border-hair px-3 py-2 text-right tabular-nums group-hover:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)] ${col.groupStart ? "border-l" : ""} ${isLast ? "sticky right-0 z-10 border-l" : ""} ${col.signed && v < 0 ? "text-crit" : ""} ${rowBg}`}
                    >
                      {col.format === "percent" ? fmtPct.format(v) : fmt.format(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
