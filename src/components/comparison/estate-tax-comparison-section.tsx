import Link from "next/link";
import { EstateTaxComparisonTable } from "@/components/comparison/estate-tax-comparison-table";
import { LiquidityComparisonCharts } from "@/components/comparison/liquidity-comparison-charts";
import { ImpactVsBasePanel } from "@/components/comparison/impact-vs-base-panel";
import type { ProjectionResult } from "@/engine/projection";
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";

interface Props {
  clientId: string;
  plan1Result: ProjectionResult;
  plan2Result: ProjectionResult;
  plan1Id: string;
  plan2Id: string;
  plan1Label: string;
  plan2Label: string;
  liquidity1Rows: YearlyLiquidityReport["rows"];
  liquidity2Rows: YearlyLiquidityReport["rows"];
  finalEstate1: YearlyEstateRow | null;
  finalEstate2: YearlyEstateRow | null;
}

export function EstateTaxComparisonSection(p: Props) {
  const showImpactPanel = p.finalEstate1 !== null && p.finalEstate2 !== null;
  const impactYear = p.finalEstate1?.year ?? p.finalEstate2?.year ?? null;

  return (
    <section className="space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Estate</h2>
        <div className="space-x-3 text-xs text-slate-400">
          <Link
            href={`/clients/${p.clientId}/estate-planning/estate-tax?scenario=${p.plan1Id}`}
            className="hover:text-slate-200"
          >
            View {p.plan1Label} →
          </Link>
          <Link
            href={`/clients/${p.clientId}/estate-planning/estate-tax?scenario=${p.plan2Id}`}
            className="hover:text-slate-200"
          >
            View {p.plan2Label} →
          </Link>
        </div>
      </div>

      <LiquidityComparisonCharts
        plan1Label={p.plan1Label}
        plan2Label={p.plan2Label}
        plan1Rows={p.liquidity1Rows}
        plan2Rows={p.liquidity2Rows}
      />

      {showImpactPanel && impactYear !== null && p.finalEstate1 && p.finalEstate2 && (
        <ImpactVsBasePanel
          year={impactYear}
          plan1Label={p.plan1Label}
          plan2Label={p.plan2Label}
          plan1={{
            totalToHeirs: p.finalEstate1.totalToHeirs,
            taxesAndExpenses: p.finalEstate1.taxesAndExpenses,
            totalToCharities: p.finalEstate1.charity,
          }}
          plan2={{
            totalToHeirs: p.finalEstate2.totalToHeirs,
            taxesAndExpenses: p.finalEstate2.taxesAndExpenses,
            totalToCharities: p.finalEstate2.charity,
          }}
        />
      )}

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-slate-100">Estate Tax Breakdown</h3>
        <EstateTaxComparisonTable
          plan1Result={p.plan1Result}
          plan2Result={p.plan2Result}
          plan1Label={p.plan1Label}
          plan2Label={p.plan2Label}
        />
      </div>
    </section>
  );
}
