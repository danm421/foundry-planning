import Link from "next/link";
import { EstateTaxComparisonTable } from "@/components/comparison/estate-tax-comparison-table";
import { LiquidityComparisonCharts } from "@/components/comparison/liquidity-comparison-charts";
import { ImpactVsBasePanel } from "@/components/comparison/impact-vs-base-panel";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

interface Props { clientId: string; plans: ComparisonPlan[]; }

export function EstateTaxComparisonSection({ clientId, plans }: Props) {
  const plan1 = plans[0];
  const plan2 = plans[1] ?? plans[0];
  const showImpactPanel = plan1.finalEstate !== null && plan2.finalEstate !== null;
  const impactYear = plan1.finalEstate?.year ?? plan2.finalEstate?.year ?? null;

  return (
    <section className="space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Estate</h2>
        <div className="space-x-3 text-xs text-slate-400">
          <Link href={`/clients/${clientId}/estate-planning/estate-tax?scenario=${plan1.id}`} className="hover:text-slate-200">
            View {plan1.label} →
          </Link>
          <Link href={`/clients/${clientId}/estate-planning/estate-tax?scenario=${plan2.id}`} className="hover:text-slate-200">
            View {plan2.label} →
          </Link>
        </div>
      </div>

      <LiquidityComparisonCharts
        plan1Label={plan1.label}
        plan2Label={plan2.label}
        plan1Rows={plan1.liquidityRows}
        plan2Rows={plan2.liquidityRows}
      />

      {showImpactPanel && impactYear !== null && plan1.finalEstate && plan2.finalEstate && (
        <ImpactVsBasePanel
          year={impactYear}
          plan1Label={plan1.label}
          plan2Label={plan2.label}
          plan1={{
            totalToHeirs: plan1.finalEstate.totalToHeirs,
            taxesAndExpenses: plan1.finalEstate.taxesAndExpenses,
            totalToCharities: plan1.finalEstate.charity,
          }}
          plan2={{
            totalToHeirs: plan2.finalEstate.totalToHeirs,
            taxesAndExpenses: plan2.finalEstate.taxesAndExpenses,
            totalToCharities: plan2.finalEstate.charity,
          }}
        />
      )}

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-slate-100">Estate Tax Breakdown</h3>
        <EstateTaxComparisonTable
          plan1Result={plan1.result}
          plan2Result={plan2.result}
          plan1Label={plan1.label}
          plan2Label={plan2.label}
        />
      </div>
    </section>
  );
}
