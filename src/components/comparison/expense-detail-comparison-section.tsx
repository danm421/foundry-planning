"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { ClientInfo, Expense, ProjectionYear } from "@/engine/types";
import { seriesColor } from "@/lib/comparison/series-palette";

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function currentYear(years: ProjectionYear[]): number {
  const now = new Date().getUTCFullYear();
  if (years.length === 0) return now;
  const first = years[0].year;
  const last = years[years.length - 1].year;
  if (now < first) return first;
  if (now > last) return last;
  return now;
}

function retirementYear(client: ClientInfo | undefined): number | null {
  if (!client) return null;
  const a = client.dateOfBirth
    ? Number(client.dateOfBirth.slice(0, 4)) + (client.retirementAge ?? 0)
    : null;
  const b = client.spouseDob
    ? Number(client.spouseDob.slice(0, 4)) + (client.spouseRetirementAge ?? 0)
    : null;
  const candidates = [a, b].filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function amountInYear(
  years: ProjectionYear[],
  expenseId: string,
  year: number,
): number {
  const y = years.find((r) => r.year === year);
  return y?.expenses?.bySource?.[expenseId] ?? 0;
}

function PlanColumn({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const expenses = (plan.tree.expenses ?? []) as Expense[];
  const years = (plan.result.years ?? []) as ProjectionYear[];
  const client = plan.tree.client as ClientInfo | undefined;
  const curY = currentYear(years);
  const retY = retirementYear(client) ?? curY;
  const living = expenses.filter((e) => e.type === "living");
  const events = expenses.filter(
    (e) => e.type !== "living" && e.endYear - e.startYear < 50,
  );
  const livingCur = living.reduce(
    (s, e) => s + amountInYear(years, e.id, curY),
    0,
  );
  const livingRet = living.reduce(
    (s, e) => s + amountInYear(years, e.id, retY),
    0,
  );
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {plan.label}
        </span>
      </div>
      <table className="mb-3 w-full text-xs">
        <thead className="text-slate-400">
          <tr>
            <th className="text-left font-normal">Category</th>
            <th className="text-right font-normal">Current ({curY})</th>
            <th className="text-right font-normal">Retirement ({retY})</th>
          </tr>
        </thead>
        <tbody>
          {living.map((e) => (
            <tr key={e.id} className="text-slate-200">
              <td className="py-0.5">{e.name}</td>
              <td className="text-right tabular-nums">
                {fmt(amountInYear(years, e.id, curY))}
              </td>
              <td className="text-right tabular-nums">
                {fmt(amountInYear(years, e.id, retY))}
              </td>
            </tr>
          ))}
          <tr className="border-t border-slate-700 text-slate-100">
            <td className="py-0.5 font-semibold">Total Living Expenses</td>
            <td className="text-right font-semibold tabular-nums">
              {fmt(livingCur)}
            </td>
            <td className="text-right font-semibold tabular-nums">
              {fmt(livingRet)}
            </td>
          </tr>
        </tbody>
      </table>
      {events.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="text-left font-normal">Expense</th>
              <th className="text-right font-normal">Year(s)</th>
              <th className="text-right font-normal">Annual Amount</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="text-slate-200">
                <td className="py-0.5">{e.name}</td>
                <td className="text-right tabular-nums">
                  {e.startYear === e.endYear
                    ? e.startYear
                    : `${e.startYear}–${e.endYear}`}
                </td>
                <td className="text-right tabular-nums">{fmt(e.annualAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ExpenseDetailComparisonSection({
  plans,
}: {
  plans: ComparisonPlan[];
}) {
  const cols =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-3";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">
        Expense Detail
      </h2>
      <div className={`grid gap-4 ${cols}`}>
        {plans.map((p, i) => (
          <PlanColumn key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
