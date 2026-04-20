import type { MonteCarloSummary } from "@/engine";
import { formatShortCurrency, formatPercent } from "./lib/format";

interface YearlyBreakdownProps {
  summary: MonteCarloSummary;
}

function formatCagr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPercent(value);
}

export function YearlyBreakdown({ summary }: YearlyBreakdownProps) {
  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold text-slate-100">Monte Carlo Asset Spread</h3>
        <span className="text-[11px] text-slate-500">Percentile balances by year</span>
      </div>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 text-left font-medium">Year</th>
              <th className="px-4 py-2 text-left font-medium">Age</th>
              <th className="px-4 py-2 text-right font-medium">Above Avg. (p80)</th>
              <th className="px-4 py-2 text-right font-medium text-slate-500">CAGR</th>
              <th className="px-4 py-2 text-right font-medium">Average (p50)</th>
              <th className="px-4 py-2 text-right font-medium text-slate-500">CAGR</th>
              <th className="px-4 py-2 text-right font-medium">Below Avg. (p20)</th>
              <th className="px-4 py-2 text-right font-medium text-slate-500">CAGR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {summary.byYear.map((y) => {
              const age =
                y.age.spouse != null
                  ? `${y.age.client} / ${y.age.spouse}`
                  : `${y.age.client}`;
              return (
                <tr key={y.year} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2 text-slate-200">{y.year}</td>
                  <td className="px-4 py-2 text-slate-400">{age}</td>
                  <td className="px-4 py-2 text-right text-slate-300 tabular-nums">
                    {formatShortCurrency(y.balance.p80)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">
                    {formatCagr(y.cagrFromStart?.p80)}
                  </td>
                  <td className="px-4 py-2 text-right text-emerald-300 tabular-nums">
                    {formatShortCurrency(y.balance.p50)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">
                    {formatCagr(y.cagrFromStart?.p50)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-300 tabular-nums">
                    {formatShortCurrency(y.balance.p20)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">
                    {formatCagr(y.cagrFromStart?.p20)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
