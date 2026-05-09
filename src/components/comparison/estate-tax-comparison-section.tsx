import Link from "next/link";
import { EstateTaxComparisonTable } from "@/components/comparison/estate-tax-comparison-table";
import type { ProjectionResult } from "@/engine/projection";

interface Props {
  clientId: string;
  plan1Result: ProjectionResult;
  plan2Result: ProjectionResult;
  plan1Id: string;
  plan2Id: string;
  plan1Label: string;
  plan2Label: string;
}

export function EstateTaxComparisonSection(p: Props) {
  return (
    <section className="px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Estate Tax Breakdown</h2>
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
      <EstateTaxComparisonTable
        plan1Result={p.plan1Result}
        plan2Result={p.plan2Result}
        plan1Label={p.plan1Label}
        plan2Label={p.plan2Label}
      />
    </section>
  );
}
