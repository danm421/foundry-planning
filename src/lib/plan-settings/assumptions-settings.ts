// The `settings` prop the Assumptions editors render from (form strings, not
// engine numbers). Shared by the Details loader, the component and the
// scenario adapter in lib/scenario/view-adapters.
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
  capitalLossCarryforwardSt: string;
  capitalLossCarryforwardLt: string;
  capitalLossCarryforwardLtSourceYear: number | null;
  surplusSpendPct: string;
  surplusSaveAccountId: string | null;
  surplusSpendAllUntilRetirement: boolean;
  coveredByWorkplacePlan: "auto" | "yes" | "no";
  spouseCoveredByWorkplacePlan: "auto" | "yes" | "no";
}
