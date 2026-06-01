"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { bucketByDecade } from "@/lib/comparison/decade-buckets";
import { seriesColor } from "@/lib/comparison/series-palette";
import { chartChrome, useThemeName } from "@/lib/chart-colors";

const fmtMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Metric {
  key: "income" | "expenses" | "net" | "tax" | "charity";
  label: string;
  valueFor: (y: ProjectionYear) => number;
}

const METRICS: Metric[] = [
  { key: "income",   label: "Income",       valueFor: (y) => y.totalIncome },
  { key: "expenses", label: "Expenses",     valueFor: (y) => y.totalExpenses },
  { key: "net",      label: "Net Cash",     valueFor: (y) => y.netCashFlow },
  { key: "tax",      label: "Total Tax",    valueFor: (y) => y.taxResult?.flow.totalTax ?? 0 },
  { key: "charity",  label: "Charitable",   valueFor: (y) => y.charitableOutflows ?? 0 },
];

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

export function DecadeSummaryComparisonSection({ plans, yearRange }: Props) {
  const theme = useThemeName();
  const perPlanBuckets = useMemo(
    () => plans.map((p) => bucketByDecade(clip(p.result.years, yearRange))),
    [plans, yearRange],
  );

  const allDecades = useMemo(() => {
    const set = new Set<number>();
    for (const buckets of perPlanBuckets)
      for (const b of buckets) set.add(b.decadeStart);
    return [...set].sort((a, b) => a - b);
  }, [perPlanBuckets]);

  if (allDecades.length === 0) {
    return (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-ink">Decade Summary</h2>
        <p className="rounded border border-hair bg-card p-6 text-sm text-ink-3">
          No projection years in selected range.
        </p>
      </section>
    );
  }

  const sumFor = (planIdx: number, decadeStart: number, m: Metric): number => {
    const bucket = perPlanBuckets[planIdx].find((b) => b.decadeStart === decadeStart);
    if (!bucket) return 0;
    return bucket.years.reduce((s, y) => s + m.valueFor(y), 0);
  };

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-ink">Decade Summary</h2>
      <div className="max-h-[60vh] overflow-auto rounded border border-hair">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card backdrop-blur">
            <tr>
              <th className="sticky left-0 z-20 bg-card px-3 py-2 text-left font-medium text-ink-2">
                Decade
              </th>
              {plans.map((p, i) => (
                <th
                  key={p.id}
                  colSpan={METRICS.length}
                  className="border-l border-hair px-3 py-2 text-center font-medium"
                  style={{ color: seriesColor(i) ?? chartChrome(theme).tick }}
                >
                  {p.label}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-20 bg-card px-3 py-2 text-left text-xs font-normal text-ink-3">
                &nbsp;
              </th>
              {plans.map((p) =>
                METRICS.map((m) => (
                  <th
                    key={`${p.id}-${m.key}`}
                    className="border-l border-hair px-2 py-2 text-right text-xs font-normal text-ink-3"
                  >
                    {m.label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {allDecades.map((d) => (
              <tr key={d} className="border-t border-hair">
                <td className="sticky left-0 z-10 bg-card px-3 py-2 text-ink">
                  {d}s
                </td>
                {plans.map((p, i) =>
                  METRICS.map((m) => (
                    <td
                      key={`${p.id}-${d}-${m.key}`}
                      className="border-l border-hair px-2 py-2 text-right tabular-nums text-ink-2"
                    >
                      {fmtMoney.format(sumFor(i, d, m))}
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
