import type { ClientData, ProjectionResult } from "@/engine/types";

export interface YearlyLiquidityReportInput {
  projection: ProjectionResult;
  clientData: ClientData;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
}

export interface YearlyLiquidityRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  insuranceInEstate: number;
  insuranceOutOfEstate: number;
  totalInsuranceBenefit: number;
  totalPortfolioAssets: number;
  totalTransferCost: number;
  /** Pre-computed both ways so the view's toggle is instantaneous. */
  surplusDeficitWithPortfolio: number;
  surplusDeficitInsuranceOnly: number;
}

export interface YearlyLiquidityReport {
  rows: YearlyLiquidityRow[];
  totals: {
    insuranceInEstate: number;
    insuranceOutOfEstate: number;
    totalInsuranceBenefit: number;
    totalPortfolioAssets: number;
    totalTransferCost: number;
    surplusDeficitWithPortfolio: number;
    surplusDeficitInsuranceOnly: number;
  };
}

const ZERO_TOTALS: YearlyLiquidityReport["totals"] = {
  insuranceInEstate: 0,
  insuranceOutOfEstate: 0,
  totalInsuranceBenefit: 0,
  totalPortfolioAssets: 0,
  totalTransferCost: 0,
  surplusDeficitWithPortfolio: 0,
  surplusDeficitInsuranceOnly: 0,
};

export function buildYearlyLiquidityReport(
  _input: YearlyLiquidityReportInput,
): YearlyLiquidityReport {
  return { rows: [], totals: { ...ZERO_TOTALS } };
}
