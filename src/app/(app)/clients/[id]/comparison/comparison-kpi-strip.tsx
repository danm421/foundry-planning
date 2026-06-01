import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";
import {
  computeEndingNetWorth,
  computeYearsPortfolioSurvives,
  computeEstateTotals,
} from "@/lib/comparison/kpi";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtUsd(v: number): string {
  return usd.format(v);
}
function fmtUsdDelta(v: number): string {
  if (v === 0) return "$0";
  return `${v < 0 ? "−" : "+"}${usd.format(Math.abs(v))}`;
}
function fmtPctPts(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function fmtPctPtsDelta(v: number): string {
  const pts = v * 100;
  if (pts === 0) return "0 pts";
  return `${pts < 0 ? "−" : "+"}${Math.abs(pts).toFixed(0)} pts`;
}
function fmtYearsDelta(v: number): string {
  if (v === 0) return "0";
  return `${v < 0 ? "−" : "+"}${Math.abs(v)}`;
}
function deltaCls(v: number, better: "higher" | "lower"): string {
  if (v === 0) return "text-ink-2";
  const good = better === "higher" ? v > 0 : v < 0;
  return good ? "text-good" : "text-crit";
}

interface KpiRow {
  label: string;
  better: "higher" | "lower";
  baseline: (p: ComparisonPlan, mc: number | undefined) => string;
  delta: (
    p: ComparisonPlan,
    base: ComparisonPlan,
    mc: number | undefined,
    mcBase: number | undefined,
  ) => { text: string; raw: number } | null;
}

const ROWS: KpiRow[] = [
  {
    label: "Ending NW",
    better: "higher",
    baseline: (p) => fmtUsd(computeEndingNetWorth(p.result.years)),
    delta: (p, base) => {
      const raw =
        computeEndingNetWorth(p.result.years) - computeEndingNetWorth(base.result.years);
      return { text: fmtUsdDelta(raw), raw };
    },
  },
  {
    label: "MC Success",
    better: "higher",
    baseline: (_p, mc) => (mc === undefined ? "…" : fmtPctPts(mc)),
    delta: (_p, _base, mc, mcBase) => {
      if (mc === undefined || mcBase === undefined) return null;
      const raw = mc - mcBase;
      return { text: fmtPctPtsDelta(raw), raw };
    },
  },
  {
    label: "Lifetime Tax",
    better: "lower",
    baseline: (p) => fmtUsd(p.lifetime.total),
    delta: (p, base) => {
      const raw = p.lifetime.total - base.lifetime.total;
      return { text: fmtUsdDelta(raw), raw };
    },
  },
  {
    label: "To Heirs",
    better: "higher",
    baseline: (p) => fmtUsd(p.finalEstate?.totalToHeirs ?? 0),
    delta: (p, base) => {
      const raw =
        (p.finalEstate?.totalToHeirs ?? 0) - (base.finalEstate?.totalToHeirs ?? 0);
      return { text: fmtUsdDelta(raw), raw };
    },
  },
  {
    label: "Estate Tax",
    better: "lower",
    baseline: (p) => {
      const t = computeEstateTotals(p.result);
      return fmtUsd(t.totalEstateTax + t.totalAdminExpenses);
    },
    delta: (p, base) => {
      const a = computeEstateTotals(p.result);
      const b = computeEstateTotals(base.result);
      const raw =
        a.totalEstateTax + a.totalAdminExpenses - (b.totalEstateTax + b.totalAdminExpenses);
      return { text: fmtUsdDelta(raw), raw };
    },
  },
  {
    label: "Years Survives",
    better: "higher",
    baseline: (p) => String(computeYearsPortfolioSurvives(p.result.years)),
    delta: (p, base) => {
      const raw =
        computeYearsPortfolioSurvives(p.result.years) -
        computeYearsPortfolioSurvives(base.result.years);
      return { text: fmtYearsDelta(raw), raw };
    },
  },
];

interface Props {
  plans: ComparisonPlan[];
  mcSuccessByIndex: Record<number, number>;
}

export function ComparisonKpiStrip({ plans, mcSuccessByIndex }: Props) {
  const base = plans[0];
  const mcBase = mcSuccessByIndex[0];
  const cols = `repeat(${plans.length}, minmax(0, 1fr))`;
  return (
    <div
      role="table"
      aria-label="Plan comparison KPI strip"
      className="sticky top-[64px] z-10 border-b border-hair bg-paper"
    >
      <div
        role="row"
        className="grid border-b border-hair"
        style={{ gridTemplateColumns: cols }}
      >
        {plans.map((p, i) => (
          <div
            key={p.index}
            role="columnheader"
            className="border-l border-hair px-4 py-2 first:border-l-0"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: seriesColor(i) }}
                aria-hidden
              />
              <span className="truncate text-sm font-semibold text-ink">
                {p.label}
              </span>
              {p.isBaseline && (
                <span className="rounded border border-hair px-1 text-[10px] uppercase text-ink-3">
                  Baseline
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: cols }}>
        {plans.map((p, colIdx) => (
          <div
            key={p.index}
            data-testid={`kpi-col-${colIdx}`}
            className="border-l border-hair first:border-l-0"
          >
            {ROWS.map((row) => {
              const mc = mcSuccessByIndex[colIdx];
              if (p.isBaseline) {
                return (
                  <div key={row.label} className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-ink-3">
                      {row.label}
                    </div>
                    <div className="text-xl font-semibold text-ink">
                      {row.baseline(p, mc)}
                    </div>
                  </div>
                );
              }
              const d = row.delta(p, base, mc, mcBase);
              return (
                <div key={row.label} className="px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">
                    {row.label}
                  </div>
                  <div
                    className={`text-xl font-semibold ${
                      d === null ? "text-ink-3" : deltaCls(d.raw, row.better)
                    }`}
                  >
                    {d?.text ?? "…"}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
