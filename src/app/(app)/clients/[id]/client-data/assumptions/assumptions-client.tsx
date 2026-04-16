"use client";

import { useState } from "react";
import AssumptionsSubtabs from "@/components/assumptions-subtabs";
import PlanHorizonForm from "@/components/forms/plan-horizon-form";
import TaxRatesForm from "@/components/forms/tax-rates-form";
import GrowthInflationForm from "@/components/forms/growth-inflation-form";
import WithdrawalStrategySection from "@/components/withdrawal-strategy-section";
import type { WithdrawalAccount, WithdrawalStrategy } from "@/components/withdrawal-strategy-section";
import type { ClientMilestones } from "@/lib/milestones";

export interface AssumptionsSettings {
  flatFederalRate: string;
  flatStateRate: string;
  inflationRate: string;
  planStartYear: number;
  planEndYear: number;
  defaultGrowthTaxable: string;
  defaultGrowthCash: string;
  defaultGrowthRetirement: string;
  defaultGrowthRealEstate: string;
  defaultGrowthBusiness: string;
  defaultGrowthLifeInsurance: string;
  growthSourceTaxable?: string;
  growthSourceCash?: string;
  growthSourceRetirement?: string;
  modelPortfolioIdTaxable?: string | null;
  modelPortfolioIdCash?: string | null;
  modelPortfolioIdRetirement?: string | null;
  taxEngineMode: "flat" | "bracket";
  taxInflationRate: string;
  ssWageGrowthRate: string;
}

interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
}

interface AssumptionsClientProps {
  clientId: string;
  settings: AssumptionsSettings;
  accounts: WithdrawalAccount[];
  withdrawalStrategies: WithdrawalStrategy[];
  milestones?: ClientMilestones;
  modelPortfolios?: ModelPortfolioOption[];
}

const TABS = [
  { id: "plan-horizon", label: "Plan Horizon" },
  { id: "tax-rates", label: "Tax Rates" },
  { id: "growth-inflation", label: "Growth & Inflation" },
  { id: "withdrawal", label: "Withdrawal Strategy" },
];

export default function AssumptionsClient({
  clientId,
  settings,
  accounts,
  withdrawalStrategies,
  milestones,
  modelPortfolios,
}: AssumptionsClientProps) {
  const [activeTab, setActiveTab] = useState("plan-horizon");

  return (
    <div className="space-y-6">
      <AssumptionsSubtabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
        {activeTab === "plan-horizon" && (
          <PlanHorizonForm
            clientId={clientId}
            planStartYear={settings.planStartYear}
            planEndYear={settings.planEndYear}
          />
        )}
        {activeTab === "tax-rates" && (
          <TaxRatesForm
            clientId={clientId}
            flatFederalRate={settings.flatFederalRate}
            flatStateRate={settings.flatStateRate}
            initialMode={settings.taxEngineMode}
          />
        )}
        {activeTab === "growth-inflation" && (
          <GrowthInflationForm
            clientId={clientId}
            inflationRate={settings.inflationRate}
            defaultGrowthTaxable={settings.defaultGrowthTaxable}
            defaultGrowthCash={settings.defaultGrowthCash}
            defaultGrowthRetirement={settings.defaultGrowthRetirement}
            defaultGrowthRealEstate={settings.defaultGrowthRealEstate}
            defaultGrowthBusiness={settings.defaultGrowthBusiness}
            defaultGrowthLifeInsurance={settings.defaultGrowthLifeInsurance}
            growthSourceTaxable={settings.growthSourceTaxable}
            growthSourceCash={settings.growthSourceCash}
            growthSourceRetirement={settings.growthSourceRetirement}
            modelPortfolioIdTaxable={settings.modelPortfolioIdTaxable}
            modelPortfolioIdCash={settings.modelPortfolioIdCash}
            modelPortfolioIdRetirement={settings.modelPortfolioIdRetirement}
            modelPortfolios={modelPortfolios}
            taxInflationRate={settings.taxInflationRate}
            ssWageGrowthRate={settings.ssWageGrowthRate}
          />
        )}
        {activeTab === "withdrawal" && (
          <WithdrawalStrategySection
            clientId={clientId}
            accounts={accounts}
            initialStrategies={withdrawalStrategies}
            milestones={milestones}
          />
        )}
      </div>
    </div>
  );
}
