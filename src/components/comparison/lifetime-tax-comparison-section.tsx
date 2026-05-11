import { LifetimeTaxComparisonChart } from "@/components/comparison/lifetime-tax-comparison-chart";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
function fmtUsdDelta(v: number): string {
  if (v === 0) return "$0";
  return `${v < 0 ? "−" : "+"}${usd.format(Math.abs(v))}`;
}

interface Props { plans: ComparisonPlan[]; }

export function LifetimeTaxComparisonSection({ plans }: Props) {
  const base = plans[0];
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Total Income Taxes Paid</h2>
      <div
        className="mb-6 grid gap-4 rounded border border-slate-800 bg-slate-950 p-4"
        style={{ gridTemplateColumns: `repeat(${plans.length}, minmax(0, 1fr))` }}
      >
        {plans.map((p, i) => {
          const delta = i === 0 ? 0 : p.lifetime.total - base.lifetime.total;
          const cls = i === 0
            ? "text-slate-100"
            : delta < 0 ? "text-emerald-400"
            : delta > 0 ? "text-rose-400" : "text-slate-300";
          return (
            <div key={i}>
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: seriesColor(i) }}
                  aria-hidden
                />
                <span className="text-xs uppercase tracking-wide text-slate-400">{p.label}</span>
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">
                {usd.format(p.lifetime.total)}
              </div>
              {i !== 0 && (
                <div className={`mt-1 text-xs font-semibold ${cls}`}>
                  {fmtUsdDelta(delta)} vs baseline
                </div>
              )}
            </div>
          );
        })}
      </div>
      <LifetimeTaxComparisonChart
        plans={plans.map((p) => ({ label: p.label, buckets: p.lifetime.byBucket }))}
      />
    </section>
  );
}
