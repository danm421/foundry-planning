import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import {
  computeEndingNetWorth,
  computeYearsPortfolioSurvives,
  computeEstateTotals,
} from "@/lib/comparison/kpi";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtUsdDelta(v: number | undefined): string {
  if (v === undefined) return "…";
  if (v === 0) return "$0";
  return `${v < 0 ? "−" : "+"}${usd.format(Math.abs(v))}`;
}
function fmtPctPtsDelta(v: number | undefined): string {
  if (v === undefined) return "…";
  const pts = v * 100;
  if (pts === 0) return "0 pts";
  return `${pts < 0 ? "−" : "+"}${Math.abs(pts).toFixed(0)} pts`;
}
function fmtYearsDelta(v: number | undefined): string {
  if (v === undefined) return "…";
  if (v === 0) return "0";
  return `${v < 0 ? "−" : "+"}${Math.abs(v)}`;
}
function deltaClass(v: number | undefined, better: "higher" | "lower"): string {
  if (v === undefined || v === 0) return "text-slate-300";
  const isBetter = better === "higher" ? v > 0 : v < 0;
  return isBetter ? "text-emerald-400" : "text-rose-400";
}

interface Props {
  plans: ComparisonPlan[];
  mcSuccessByIndex: Record<number, number>;
}

export function ComparisonKpiStrip({ plans, mcSuccessByIndex }: Props) {
  const p1 = plans[0];
  const p2 = plans[1] ?? plans[0];

  const endingNetWorthDelta =
    computeEndingNetWorth(p2.result.years) - computeEndingNetWorth(p1.result.years);
  const lifetimeTaxDelta = p2.lifetime.total - p1.lifetime.total;
  const e1 = computeEstateTotals(p1.result);
  const e2 = computeEstateTotals(p2.result);
  const estateTaxDelta =
    e2.totalEstateTax + e2.totalAdminExpenses - (e1.totalEstateTax + e1.totalAdminExpenses);
  const toHeirsDelta =
    (p2.finalEstate?.totalToHeirs ?? 0) - (p1.finalEstate?.totalToHeirs ?? 0);
  const yearsSurvivesDelta =
    computeYearsPortfolioSurvives(p2.result.years) - computeYearsPortfolioSurvives(p1.result.years);

  const mc1 = mcSuccessByIndex[0];
  const mc2 = mcSuccessByIndex[1];
  const mcSuccessDelta = mc1 !== undefined && mc2 !== undefined ? mc2 - mc1 : undefined;

  const tiles = [
    { label: "Ending NW", value: fmtUsdDelta(endingNetWorthDelta), cls: deltaClass(endingNetWorthDelta, "higher") },
    { label: "MC Success", value: fmtPctPtsDelta(mcSuccessDelta), cls: deltaClass(mcSuccessDelta, "higher") },
    { label: "Lifetime Tax", value: fmtUsdDelta(lifetimeTaxDelta), cls: deltaClass(lifetimeTaxDelta, "lower") },
    { label: "To Heirs", value: fmtUsdDelta(toHeirsDelta), cls: deltaClass(toHeirsDelta, "higher") },
    { label: "Estate Tax", value: fmtUsdDelta(estateTaxDelta), cls: deltaClass(estateTaxDelta, "lower") },
    { label: "Years Survives", value: fmtYearsDelta(yearsSurvivesDelta), cls: deltaClass(yearsSurvivesDelta, "higher") },
  ];
  return (
    <div className="sticky top-[57px] z-10 grid grid-cols-3 gap-px border-b border-slate-800 bg-slate-900 md:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="bg-slate-950 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">{t.label}</div>
          <div className={`text-xl font-semibold ${t.cls}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}
