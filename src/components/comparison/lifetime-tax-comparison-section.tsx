import { LifetimeTaxComparisonChart } from "@/components/comparison/lifetime-tax-comparison-chart";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtDelta(v: number): string {
  if (v === 0) return "$0";
  return `${v < 0 ? "−" : "+"}${usd.format(Math.abs(v))}`;
}

interface Props { plans: ComparisonPlan[]; }

export function LifetimeTaxComparisonSection({ plans }: Props) {
  const plan1 = plans[0];
  const plan2 = plans[1] ?? plans[0];
  const delta = plan2.lifetime.total - plan1.lifetime.total;
  const pctChange = plan1.lifetime.total === 0 ? 0 : (delta / plan1.lifetime.total) * 100;
  const deltaCls = delta < 0 ? "text-emerald-400" : delta > 0 ? "text-rose-400" : "text-slate-300";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Total Income Taxes Paid</h2>
      <div className="mb-6 grid grid-cols-3 gap-4 rounded border border-slate-800 bg-slate-950 p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{plan1.label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{usd.format(plan1.lifetime.total)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{plan2.label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{usd.format(plan2.lifetime.total)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Δ</div>
          <div className={`mt-1 text-2xl font-semibold ${deltaCls}`}>
            {fmtDelta(delta)} <span className="text-sm font-normal text-slate-400">({pctChange.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
      <LifetimeTaxComparisonChart
        plan1Buckets={plan1.lifetime.byBucket}
        plan2Buckets={plan2.lifetime.byBucket}
        plan1Label={plan1.label}
        plan2Label={plan2.label}
      />
    </section>
  );
}
