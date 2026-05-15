import type { ComparisonWidgetKindV4 } from "../layout-schema";
import type { ComparisonWidgetDefinition } from "./types";
import { kpiWidget } from "./kpi";
import { kpiStripWidget } from "./kpi-strip";
import { portfolioWidget } from "./portfolio";
import { monteCarloWidget } from "./monte-carlo";
import { longevityWidget } from "./longevity";
import { lifetimeTaxWidget } from "./lifetime-tax";
import { liquidityWidget } from "./liquidity";
import { estateImpactWidget } from "./estate-impact";
import { estateTaxWidget } from "./estate-tax";
import { textWidget } from "./text";
import { incomeExpenseWidget } from "./income-expense";
import { withdrawalSourceWidget } from "./withdrawal-source";
import { yearByYearWidget } from "./year-by-year";
import { ssIncomeWidget } from "./ss-income";
import { allocationDriftWidget } from "./allocation-drift";
import { taxBracketFillWidget } from "./tax-bracket-fill";
import { rothLadderWidget } from "./roth-ladder";
import { rmdScheduleWidget } from "./rmd-schedule";
import { charitableImpactWidget } from "./charitable-impact";
import { decadeSummaryWidget } from "./decade-summary";
import { cashFlowGapWidget } from "./cash-flow-gap";
import { successGaugeWidget } from "./success-gauge";
import { estateEndBeneficiariesWidget } from "./estate-end-beneficiaries";
import { estateDistributionFormWidget } from "./estate-distribution-form";
import { estateTransfersYearlyWidget } from "./estate-transfers-yearly";
import { giftTaxWidget } from "./gift-tax";
import { majorTransactionsWidget } from "./major-transactions";
import { clientProfileWidget } from "./client-profile";
import { incomeSourcesWidget } from "./income-sources";
import { balanceSheetWidget } from "./balance-sheet";
import { expenseDetailWidget } from "./expense-detail";
import { assetAllocationWidget } from "./asset-allocation";
import { scenarioChangesWidget } from "./scenario-changes";

export const COMPARISON_WIDGETS: Record<
  ComparisonWidgetKindV4,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ComparisonWidgetDefinition<any>
> = {
  kpi: kpiWidget,
  "kpi-strip": kpiStripWidget,
  portfolio: portfolioWidget,
  "monte-carlo": monteCarloWidget,
  longevity: longevityWidget,
  "lifetime-tax": lifetimeTaxWidget,
  liquidity: liquidityWidget,
  "estate-impact": estateImpactWidget,
  "estate-tax": estateTaxWidget,
  text: textWidget,
  "income-expense": incomeExpenseWidget,
  "withdrawal-source": withdrawalSourceWidget,
  "year-by-year": yearByYearWidget,
  "ss-income": ssIncomeWidget,
  "allocation-drift": allocationDriftWidget,
  "tax-bracket-fill": taxBracketFillWidget,
  "roth-ladder": rothLadderWidget,
  "rmd-schedule": rmdScheduleWidget,
  "charitable-impact": charitableImpactWidget,
  "decade-summary": decadeSummaryWidget,
  "cash-flow-gap": cashFlowGapWidget,
  "success-gauge": successGaugeWidget,
  "estate-end-beneficiaries": estateEndBeneficiariesWidget,
  "estate-distribution-form": estateDistributionFormWidget,
  "estate-transfers-yearly": estateTransfersYearlyWidget,
  "gift-tax": giftTaxWidget,
  "major-transactions": majorTransactionsWidget,
  "client-profile": clientProfileWidget,
  "income-sources": incomeSourcesWidget,
  "balance-sheet": balanceSheetWidget,
  "expense-detail": expenseDetailWidget,
  "asset-allocation": assetAllocationWidget,
  "scenario-changes": scenarioChangesWidget,
};
