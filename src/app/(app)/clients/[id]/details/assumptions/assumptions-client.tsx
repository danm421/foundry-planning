"use client";

import { useState } from "react";
import AssumptionsSubtabs from "@/components/assumptions-subtabs";
import TaxRatesForm from "@/components/forms/tax-rates-form";
import GrowthInflationForm from "@/components/forms/growth-inflation-form";
import SurplusCashFlowForm from "@/components/forms/surplus-cash-flow-form";
import WithdrawalStrategySection from "@/components/withdrawal-strategy-section";
import type { WithdrawalAccount, WithdrawalStrategy } from "@/components/withdrawal-strategy-section";
import type { ClientMilestones } from "@/lib/milestones";
import { DeductionsClient } from "./deductions-client";
import AccountGroupsTab from "./account-groups-tab";
import type {
  DerivedRow,
  ExpenseDeductionRow,
  MortgageInterestRow,
  PropertyTaxRow,
} from "@/components/deductions-derived-summary";
import type { LiquidAccount, AssetAccount } from "@/components/account-groups/types";

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
  residenceState: import("@/lib/usps-states").USPSStateCode | null;
  irdTaxRate: string;
  probateCostRate: string;
  pvDiscountRate: string;
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
  growthSourceRealEstate?: string;
  growthSourceBusiness?: string;
  growthSourceLifeInsurance?: string;
  modelPortfolioIdTaxable?: string | null;
  modelPortfolioIdCash?: string | null;
  modelPortfolioIdRetirement?: string | null;
  taxEngineMode: "flat" | "bracket";
  taxInflationRate: string;
  lifetimeExemptionCap: string;
  ssWageGrowthRate: string;
  medicarePremiumInflationRate: string;
  medicarePremiumInflationEnabled: boolean;
  outOfHouseholdDniRate: string;
  priorTaxableGiftsClient: string;
  priorTaxableGiftsSpouse: string;
  surplusSpendPct: string;
  surplusSaveAccountId: string | null;
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
  liquidAccounts: LiquidAccount[];
  allAccounts: AssetAccount[];
  /** Reserved seam for wizard-mode trimming. Today the wrapper in
   *  assumptions/page.tsx supplies the page h2 + max-w-3xl; wizard mode
   *  drops both via the step component rather than via this prop. */
  embed?: "page" | "wizard";
}

const TABS = [
  { id: "tax-rates", label: "Tax Rates" },
  { id: "growth-inflation", label: "Growth & Inflation" },
  { id: "withdrawal", label: "Savings & Withdrawals" },
  { id: "deductions", label: "Deductions" },
  { id: "account-groups", label: "Account Groups" },
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
  liquidAccounts,
  allAccounts,
}: AssumptionsClientProps) {
  const [activeTab, setActiveTab] = useState("tax-rates");

  return (
    <div className="space-y-6">
      <AssumptionsSubtabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="rounded-lg border border-hair bg-card p-6">
        {activeTab === "tax-rates" && (
          <TaxRatesForm
            clientId={clientId}
            flatFederalRate={settings.flatFederalRate}
            flatStateRate={settings.flatStateRate}
            estateAdminExpenses={settings.estateAdminExpenses}
            flatStateEstateRate={settings.flatStateEstateRate}
            residenceState={settings.residenceState}
            irdTaxRate={settings.irdTaxRate}
            probateCostRate={settings.probateCostRate}
            pvDiscountRate={settings.pvDiscountRate}
            lifetimeExemptionCap={settings.lifetimeExemptionCap}
            outOfHouseholdDniRate={settings.outOfHouseholdDniRate}
            priorTaxableGiftsClient={settings.priorTaxableGiftsClient}
            priorTaxableGiftsSpouse={settings.priorTaxableGiftsSpouse}
            hasSpouse={Boolean(spouseFirstName)}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
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
            growthSourceRealEstate={settings.growthSourceRealEstate}
            growthSourceBusiness={settings.growthSourceBusiness}
            growthSourceLifeInsurance={settings.growthSourceLifeInsurance}
            modelPortfolioIdTaxable={settings.modelPortfolioIdTaxable}
            modelPortfolioIdCash={settings.modelPortfolioIdCash}
            modelPortfolioIdRetirement={settings.modelPortfolioIdRetirement}
            modelPortfolios={modelPortfolios}
            taxInflationRate={settings.taxInflationRate}
            ssWageGrowthRate={settings.ssWageGrowthRate}
            medicarePremiumInflationRate={settings.medicarePremiumInflationRate}
            medicarePremiumInflationEnabled={settings.medicarePremiumInflationEnabled}
          />
        )}
        {activeTab === "withdrawal" && (
          <div className="space-y-8">
            <SurplusCashFlowForm
              clientId={clientId}
              surplusSpendPct={settings.surplusSpendPct}
              surplusSaveAccountId={settings.surplusSaveAccountId}
              householdAccounts={accounts
                .filter((a) => !a.ownerEntityId)
                .map((a) => ({ id: a.id, name: a.name }))}
            />
            <WithdrawalStrategySection
              clientId={clientId}
              accounts={accounts}
              initialStrategies={withdrawalStrategies}
              milestones={milestones}
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
            />
          </div>
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
        {activeTab === "account-groups" && (
          <AccountGroupsTab
            clientId={clientId}
            liquidAccounts={liquidAccounts}
            allAccounts={allAccounts}
          />
        )}
      </div>
    </div>
  );
}
