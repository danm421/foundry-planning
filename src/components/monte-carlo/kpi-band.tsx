import type { MonteCarloSummary, ClientData, PlanSettings } from "@/engine";
import { KpiCard } from "./kpi-card";
import { SuccessGauge } from "./success-gauge";
import { formatShortCurrency } from "./lib/format";
import { annualIncomeAtStart } from "@/lib/monte-carlo/annual-income";

interface KpiBandProps {
  summary: MonteCarloSummary;
  clientData: ClientData;
  planSettings: PlanSettings;
}

function startAge(dateOfBirth: string, planStartYear: number): number {
  const birthYear = new Date(dateOfBirth).getFullYear();
  return planStartYear - birthYear;
}

export function KpiBand({ summary, clientData, planSettings }: KpiBandProps) {
  const successPct = summary.successRate;
  const medianEnding = summary.ending.p50;
  const annualIncome = annualIncomeAtStart(clientData, planSettings.planStartYear);
  const startAgeVal = startAge(clientData.client.dateOfBirth, planSettings.planStartYear);
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
