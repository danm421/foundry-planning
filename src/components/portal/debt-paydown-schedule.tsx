import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PaydownYearRow } from "@/lib/calculators/debt-paydown";

/**
 * The year-by-year payoff schedule, behind a disclosure on the calculator.
 * Dense tier (12-13px) — this is a table, not a headline. Every cell but the
 * year label is `.tabular`.
 */
export function DebtPaydownSchedule({ rows }: { rows: PaydownYearRow[] }): ReactElement {
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-3">Nothing to schedule yet.</p>;
  }
  const cell = "px-3 py-2 text-right tabular text-[12px] text-ink-2";
  const head = "px-3 py-2 text-right text-[11px] uppercase tracking-[0.08em] text-ink-3";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr className="border-b border-hair">
            <th className={`${head} text-left`}>Year</th>
            <th className={head}>Paid</th>
            <th className={head}>Principal</th>
            <th className={head}>Interest</th>
            <th className={head}>Balance left</th>
            <th className={head}>Debts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-b border-hair last:border-0">
              <td className={`${cell} text-left`}>{r.year}</td>
              <td className={cell}>{fmtUsd(r.payment)}</td>
              <td className={cell}>{fmtUsd(r.principal)}</td>
              <td className={cell}>{fmtUsd(r.interest)}</td>
              <td className={cell}>{fmtUsd(r.endingBalance)}</td>
              <td className={cell}>{r.activeDebts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
