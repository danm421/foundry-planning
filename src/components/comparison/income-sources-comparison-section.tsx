"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { EntitySummary, Income, ProjectionYear } from "@/engine/types";
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

/** Engine-side fallback when the projection doesn't cover the income's first
 *  paying year. Mirrors the formula in `engine/income.ts`: scheduleOverrides
 *  win, otherwise today's-dollars amount compounds from `inflationStartYear`
 *  to the income's `startYear`. SS pia_at_fra / claim-age math isn't
 *  resolvable here — projection lookup is the source of truth for SS. */
function firstYearFromDefinition(inc: Income): { year: number; amount: number } {
  const year = inc.startYear;
  if (inc.scheduleOverrides && year in inc.scheduleOverrides) {
    return { year, amount: inc.scheduleOverrides[year] ?? 0 };
  }
  const inflateFrom = inc.inflationStartYear ?? year;
  const yearsElapsed = year - inflateFrom;
  const amount = inc.annualAmount * Math.pow(1 + (inc.growthRate ?? 0), yearsElapsed);
  return { year, amount };
}

interface ResolvedRange {
  startYear: number;
  endYear: number;
  firstYearAmount: number;
}

/** A schedule-driven income has variable year-by-year amounts, so collapsing
 *  it to a single "first-year" number misleads. We detect either:
 *  (1) per-row `scheduleOverrides` (any income type), or
 *  (2) entity-owned rows whose entity is in `flowMode: "schedule"` — those
 *      route through `entityFlowOverrides` and ignore `annualAmount`. */
function usesSchedule(
  inc: Income,
  entitiesById: Map<string, EntitySummary>,
): boolean {
  if (inc.scheduleOverrides && Object.keys(inc.scheduleOverrides).length > 0) {
    return true;
  }
  if (inc.ownerEntityId) {
    const entity = entitiesById.get(inc.ownerEntityId);
    if (entity?.flowMode === "schedule") return true;
  }
  return false;
}

/** Resolve the income's actual paying range from the projection. The engine
 *  has already applied claim-age delays (Social Security), schedule overrides,
 *  proration gates, and termination rules — so scanning `bySource[id]` for
 *  positive amounts gives the true start/end and the true first-year value. */
function resolveRange(inc: Income, years: ProjectionYear[]): ResolvedRange {
  let firstYear: number | null = null;
  let lastYear: number | null = null;
  let firstAmount = 0;
  for (const y of years) {
    const v = y.income?.bySource?.[inc.id];
    if (typeof v !== "number" || v <= 0) continue;
    if (firstYear === null) {
      firstYear = y.year;
      firstAmount = v;
    }
    lastYear = y.year;
  }
  if (firstYear !== null && lastYear !== null) {
    return { startYear: firstYear, endYear: lastYear, firstYearAmount: firstAmount };
  }
  // Projection has no positive value for this income — fall back to the
  // definition. End year stays as the configured endYear.
  const fallback = firstYearFromDefinition(inc);
  return {
    startYear: fallback.year,
    endYear: inc.endYear,
    firstYearAmount: fallback.amount,
  };
}

function PlanColumn({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const incomes: Income[] = plan.tree.incomes ?? [];
  const years = plan.result.years ?? [];
  const entitiesById = new Map<string, EntitySummary>(
    (plan.tree.entities ?? []).map((e) => [e.id, e]),
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
              <th className="text-right font-normal">First-Year</th>
              <th className="text-right font-normal">Start</th>
              <th className="text-right font-normal">End</th>
            </tr>
          </thead>
          <tbody>
            {incomes.map((i) => {
              const r = resolveRange(i, years);
              const scheduled = usesSchedule(i, entitiesById);
              return (
                <tr key={i.id} className="text-slate-200">
                  <td className="py-0.5">{i.name}</td>
                  <td>{typeLabel(i.type)}</td>
                  <td className="text-right tabular-nums">
                    {scheduled ? (
                      <span className="text-slate-400">Schedule</span>
                    ) : (
                      fmt(r.firstYearAmount)
                    )}
                  </td>
                  <td className="text-right tabular-nums">{r.startYear}</td>
                  <td className="text-right tabular-nums">{r.endYear}</td>
                </tr>
              );
            })}
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
