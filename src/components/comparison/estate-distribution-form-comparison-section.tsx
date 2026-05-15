"use client";

import { useMemo } from "react";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import { deriveBeneficiaryDistributionForm } from "@/lib/estate/derive-beneficiary-distribution-form";
import { BeneficiaryDistributionFormChart } from "@/components/beneficiary-distribution-form-chart";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";
import { deriveOwnerNames } from "@/lib/comparison/owner-info";

interface Props {
  plans: ComparisonPlan[];
}

function PlanCard({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const beneficiaries = useMemo(() => {
    const ownerNames = deriveOwnerNames(plan.tree);
    const report = buildEstateTransferReportData({
      projection: plan.result,
      asOf: { kind: "split" },
      ordering: "primaryFirst",
      clientData: plan.tree,
      ownerNames,
    });
    return deriveBeneficiaryDistributionForm(
      report.aggregateRecipientTotals,
      plan.tree,
    );
  }, [plan]);
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {plan.label}
        </span>
      </div>
      <BeneficiaryDistributionFormChart beneficiaries={beneficiaries} />
    </div>
  );
}

export function EstateDistributionFormComparisonSection({ plans }: Props) {
  const colsClass =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-3";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">
        Beneficiary Distribution — Outright vs In-Trust
      </h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
