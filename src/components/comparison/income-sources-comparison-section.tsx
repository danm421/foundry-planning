"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { Income } from "@/engine/types";
import { seriesColor } from "@/lib/comparison/series-palette";

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

const TYPE_LABELS: Record<Income["type"], string> = {
  salary: "Salary",
  social_security: "Social Security",
  business: "Business",
  deferred: "Deferred",
  capital_gains: "Capital Gains",
  trust: "Trust",
  other: "Other",
};

function typeLabel(t: string | undefined): string {
  if (!t) return "—";
  return TYPE_LABELS[t as Income["type"]] ?? t;
}

function PlanColumn({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const incomes: Income[] = plan.tree.incomes ?? [];
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      {incomes.length === 0 ? (
        <p className="text-sm text-slate-400">No income sources.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="text-left font-normal">Source</th>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">Annual</th>
              <th className="text-right font-normal">Start</th>
              <th className="text-right font-normal">End</th>
            </tr>
          </thead>
          <tbody>
            {incomes.map((i) => (
              <tr key={i.id} className="text-slate-200">
                <td className="py-0.5">{i.name}</td>
                <td>{typeLabel(i.type)}</td>
                <td className="text-right tabular-nums">{fmt(i.annualAmount)}</td>
                <td className="text-right tabular-nums">{i.startYear}</td>
                <td className="text-right tabular-nums">{i.endYear}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function IncomeSourcesComparisonSection({ plans }: { plans: ComparisonPlan[] }) {
  const cols =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-3";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Income Sources</h2>
      <div className={`grid gap-4 ${cols}`}>
        {plans.map((p, i) => (
          <PlanColumn key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
