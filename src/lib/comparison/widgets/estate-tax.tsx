import Link from "next/link";
import { EstateTaxComparisonTable } from "@/components/comparison/estate-tax-comparison-table";
import type { ComparisonWidgetDefinition } from "./types";

export const estateTaxWidget: ComparisonWidgetDefinition = {
  kind: "estate-tax",
  title: "Estate Tax",
  needsMc: false,
  render: ({ plans, clientId }) => {
    return (
      <section className="space-y-4 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-100">Estate Tax</h2>
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
        <EstateTaxComparisonTable
          plans={plans.map((p) => ({ label: p.label, result: p.result }))}
        />
      </section>
    );
  },
};
