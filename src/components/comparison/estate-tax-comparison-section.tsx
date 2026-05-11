import Link from "next/link";
import { EstateTaxComparisonTable } from "@/components/comparison/estate-tax-comparison-table";
import { LiquidityComparisonCharts } from "@/components/comparison/liquidity-comparison-charts";
import { ImpactVsBasePanel } from "@/components/comparison/impact-vs-base-panel";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

interface Props {
  clientId: string;
  plans: ComparisonPlan[];
}

export function EstateTaxComparisonSection({ clientId, plans }: Props) {
  const allHaveFinalEstate = plans.every((p) => p.finalEstate !== null);
  const impactYear = plans.find((p) => p.finalEstate)?.finalEstate?.year ?? null;

  return (
    <section className="space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">Estate</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
          {plans.map((p) => (
            <Link
              key={p.index}
              href={`/clients/${clientId}/estate-planning/estate-tax?scenario=${p.id}`}
              className="hover:text-slate-200"
            >
              View {p.label} →
            </Link>
          ))}
        </div>
      </div>

      <LiquidityComparisonCharts plans={plans} />

      {allHaveFinalEstate && impactYear !== null && (
        <ImpactVsBasePanel year={impactYear} plans={plans} />
      )}

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-slate-100">Estate Tax Breakdown</h3>
        <EstateTaxComparisonTable
          plans={plans.map((p) => ({ label: p.label, result: p.result }))}
        />
      </div>
    </section>
  );
}
