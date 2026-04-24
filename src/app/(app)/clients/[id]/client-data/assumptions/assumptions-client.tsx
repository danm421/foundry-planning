"use client";

import { useState } from "react";
import AssumptionsSubtabs from "@/components/assumptions-subtabs";
import TaxRatesForm from "@/components/forms/tax-rates-form";
import GrowthInflationForm from "@/components/forms/growth-inflation-form";
import WithdrawalStrategySection from "@/components/withdrawal-strategy-section";
import type { WithdrawalAccount, WithdrawalStrategy } from "@/components/withdrawal-strategy-section";
import type { ClientMilestones } from "@/lib/milestones";
import { DeductionsClient } from "./deductions-client";
import type {
  DerivedRow,
  ExpenseDeductionRow,
  MortgageInterestRow,
  PropertyTaxRow,
} from "@/components/deductions-derived-summary";

export interface DeductionsTabData {
  derivedRows: DerivedRow[];
  expenseDeductionRows: ExpenseDeductionRow[];
  mortgageRows: MortgageInterestRow[];
  propertyTaxRows: PropertyTaxRow[];
  itemizedRows: {
    id: string;
    type: "charitable" | "above_line" | "below_line" | "property_tax";
    name: string | null;
    owner: "client" | "spouse" | "joint";
    annualAmount: number;
    growthRate: number;
    startYear: number;
    endYear: number;
    startYearRef: string | null;
    endYearRef: string | null;
  }[];
  currentYear: number;
  saltCap: number;
}

export interface AssumptionsSettings {
  flatFederalRate: string;
  flatStateRate: string;
  estateAdminExpenses: string;
  flatStateEstateRate: string;
  inflationRate: string;
  inflationRateSource: "asset_class" | "custom";
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
  clientFirstName?: string;
  spouseFirstName?: string;
  resolvedInflationRate: number;
  hasInflationAssetClass: boolean;
  deductionsData: DeductionsTabData;
}

const TABS = [
  { id: "tax-rates", label: "Tax Rates" },
  { id: "growth-inflation", label: "Growth & Inflation" },
  { id: "withdrawal", label: "Withdrawal Strategy" },
  { id: "deductions", label: "Deductions" },
];

export default function AssumptionsClient({
  clientId,
  settings,
  accounts,
  withdrawalStrategies,
  milestones,
  modelPortfolios,
  clientFirstName,
  spouseFirstName,
  resolvedInflationRate,
  hasInflationAssetClass,
  deductionsData,
}: AssumptionsClientProps) {
  const [activeTab, setActiveTab] = useState("tax-rates");

  return (
    <div className="space-y-6">
      <AssumptionsSubtabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
        {activeTab === "tax-rates" && (
          <TaxRatesForm
            clientId={clientId}
            flatFederalRate={settings.flatFederalRate}
            flatStateRate={settings.flatStateRate}
            estateAdminExpenses={settings.estateAdminExpenses}
            flatStateEstateRate={settings.flatStateEstateRate}
            initialMode={settings.taxEngineMode}
          />
        )}
        {activeTab === "growth-inflation" && (
          <GrowthInflationForm
            clientId={clientId}
            inflationRate={settings.inflationRate}
            inflationRateSource={settings.inflationRateSource}
            resolvedInflationRate={resolvedInflationRate}
            hasInflationAssetClass={hasInflationAssetClass}
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
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
          />
        )}
        {activeTab === "deductions" && (
          <DeductionsClient
            clientId={clientId}
            derivedRows={deductionsData.derivedRows}
            expenseDeductionRows={deductionsData.expenseDeductionRows}
            mortgageRows={deductionsData.mortgageRows}
            propertyTaxRows={deductionsData.propertyTaxRows}
            itemizedRows={deductionsData.itemizedRows}
            currentYear={deductionsData.currentYear}
            saltCap={deductionsData.saltCap}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
          />
        )}
      </div>
    </div>
  );
}
