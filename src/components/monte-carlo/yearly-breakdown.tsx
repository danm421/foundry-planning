import type { MonteCarloSummary } from "@/engine";
import { formatCurrency, formatPercent2 } from "./lib/format";

interface YearlyBreakdownProps {
  summary: MonteCarloSummary;
}

function formatCagr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPercent2(value);
}

export function YearlyBreakdown({ summary }: YearlyBreakdownProps) {
  return (
    <section className="rounded-lg bg-card ring-1 ring-hair overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold text-ink">Monte Carlo Asset Spread</h3>
        <span className="text-xs text-ink-3">Percentile balances by year</span>
      </div>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-ink-2">
              <th className="px-4 py-2 text-left font-medium">Year</th>
              <th className="px-4 py-2 text-left font-medium">Age</th>
              <th className="px-4 py-2 text-right font-medium">Above Avg. (p80)</th>
              <th className="px-4 py-2 text-right font-medium text-ink-3">CAGR</th>
              <th className="px-4 py-2 text-right font-medium">Average (p50)</th>
              <th className="px-4 py-2 text-right font-medium text-ink-3">CAGR</th>
              <th className="px-4 py-2 text-right font-medium">Below Avg. (p20)</th>
              <th className="px-4 py-2 text-right font-medium text-ink-3">CAGR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {summary.byYear.map((y) => {
              const age =
                y.age.spouse != null
                  ? `${y.age.client} / ${y.age.spouse}`
                  : `${y.age.client}`;
              return (
                <tr key={y.year} className="hover:[&>td]:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]">
                  <td className="px-4 py-2 text-ink">{y.year}</td>
                  <td className="px-4 py-2 text-ink-2">{age}</td>
                  <td className="px-4 py-2 text-right text-ink-2 tabular-nums">
                    {formatCurrency(y.balance.p80)}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-3 tabular-nums">
                    {formatCagr(y.cagrFromStart?.p80)}
                  </td>
                  <td className="px-4 py-2 text-right text-good tabular-nums">
                    {formatCurrency(y.balance.p50)}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-3 tabular-nums">
                    {formatCagr(y.cagrFromStart?.p50)}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-2 tabular-nums">
                    {formatCurrency(y.balance.p20)}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-3 tabular-nums">
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
