import type { MonteCarloSummary, ClientData, PlanSettings } from "@foundry/engine";
import { KpiCard } from "./kpi-card";
import { SuccessGauge } from "./success-gauge";
import { formatShortCurrency } from "./lib/format";

interface KpiBandProps {
  summary: MonteCarloSummary;
  clientData: ClientData;
  planSettings: PlanSettings;
}

function startAge(dateOfBirth: string, planStartYear: number): number {
  const birthYear = new Date(dateOfBirth).getFullYear();
  return planStartYear - birthYear;
}

function annualIncomeAtStart(clientData: ClientData, planStartYear: number): number {
  const incomes = (clientData.incomes ?? []) as Array<{
    annualAmount: number | string;
    startYear?: number | null;
    endYear?: number | null;
  }>;
  let total = 0;
  for (const inc of incomes) {
    const starts = inc.startYear ?? -Infinity;
    const ends = inc.endYear ?? Infinity;
    if (planStartYear >= starts && planStartYear <= ends) {
      const amt = typeof inc.annualAmount === "string" ? parseFloat(inc.annualAmount) : inc.annualAmount;
      if (Number.isFinite(amt)) total += amt;
    }
  }
  return total;
}

export function KpiBand({ summary, clientData, planSettings }: KpiBandProps) {
  const successPct = summary.successRate;
  const medianEnding = summary.ending.p50;
  const annualIncome = annualIncomeAtStart(clientData, planSettings.planStartYear);
  const startAgeVal = startAge(clientData.client.dateOfBirth, planSettings.planStartYear);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        label="Success Probability"
        value={<span className="sr-only">{Math.round(successPct * 100)}%</span>}
        visual={<SuccessGauge value={successPct} />}
        className="lg:col-span-2"
      />
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
