import { LifetimeTaxComparisonChart } from "@/components/comparison/lifetime-tax-comparison-chart";
import type { LifetimeTaxSummary } from "@/lib/comparison/lifetime-tax";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtDelta(v: number): string {
  if (v === 0) return "$0";
  return `${v < 0 ? "−" : "+"}${usd.format(Math.abs(v))}`;
}

interface Props {
  plan1: LifetimeTaxSummary;
  plan2: LifetimeTaxSummary;
  plan1Label: string;
  plan2Label: string;
}

export function LifetimeTaxComparisonSection({ plan1, plan2, plan1Label, plan2Label }: Props) {
  const delta = plan2.total - plan1.total;
  const pctChange = plan1.total === 0 ? 0 : (delta / plan1.total) * 100;
  const deltaCls = delta < 0 ? "text-emerald-400" : delta > 0 ? "text-rose-400" : "text-slate-300";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Total Income Taxes Paid</h2>
      <div className="mb-6 grid grid-cols-3 gap-4 rounded border border-slate-800 bg-slate-950 p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{plan1Label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{usd.format(plan1.total)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">{plan2Label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{usd.format(plan2.total)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Δ</div>
          <div className={`mt-1 text-2xl font-semibold ${deltaCls}`}>
            {fmtDelta(delta)} <span className="text-sm font-normal text-slate-400">({pctChange.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
      <LifetimeTaxComparisonChart
        plan1Buckets={plan1.byBucket}
        plan2Buckets={plan2.byBucket}
        plan1Label={plan1Label}
        plan2Label={plan2Label}
      />
    </section>
  );
}
