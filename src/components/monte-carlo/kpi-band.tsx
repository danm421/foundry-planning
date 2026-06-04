import type { MonteCarloSummary } from "@/engine";
import { KpiCard } from "./kpi-card";
import { SuccessGauge } from "./success-gauge";
import { formatShortCurrency } from "./lib/format";

interface KpiBandProps {
  summary: MonteCarloSummary;
  startAge: number;
  annualIncome: number;
}

export function KpiBand({ summary, startAge, annualIncome }: KpiBandProps) {
  const successPct = summary.successRate;
  const medianEnding = summary.ending.p50;
  const startAgeVal = startAge;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <div
        role="img"
        aria-label={`Success probability ${Math.round(successPct * 100)} percent`}
        className="rounded-lg bg-card ring-1 ring-hair p-4 flex items-center justify-center min-h-[96px] lg:col-span-2"
      >
        <SuccessGauge value={successPct} />
      </div>
      <KpiCard
        label="Median Portfolio Value"
        value={formatShortCurrency(medianEnding)}
      />
      <KpiCard
        label="Annual Income"
        value={formatShortCurrency(annualIncome)}
      />
      <KpiCard
        label="Start Age"
        value={startAgeVal}
      />
    </div>
  );
}
