import { describe, it, expect } from "vitest";
import { cashFlowPage, PRESENTATION_PAGES } from "../registry";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "@/lib/presentations/types";

describe("registry — Cash Flow page", () => {
  it("validates its default options via optionsSchema", () => {
    expect(() => cashFlowPage.optionsSchema.parse(CASH_FLOW_PAGE_OPTIONS_DEFAULT))
      .not.toThrow();
  });

  it("summarizes its default options to 'Full range'", () => {
    expect(cashFlowPage.summarizeOptions(CASH_FLOW_PAGE_OPTIONS_DEFAULT))
      .toBe("Full range");
  });

  it("estimates one PDF page", () => {
    // estimatePageCount currently ignores its inputs; pass undefined for data
    // and the default options.
    expect(cashFlowPage.estimatePageCount(undefined as never, CASH_FLOW_PAGE_OPTIONS_DEFAULT))
      .toBe(1);
  });

  it("exports an OptionsControl React component", () => {
    expect(typeof cashFlowPage.OptionsControl).toBe("function");
  });

  it("is registered alongside the framing pages + every cash-flow drill + income-tax + estate + investment pages in PRESENTATION_PAGES", () => {
    expect(Object.keys(PRESENTATION_PAGES).sort()).toEqual(
      [
        "assetAllocation",
        "assumptions",
        "balanceSheet",
        "blank",
        "cashFlow",
        "cashFlowActivity",
        "cashFlowAssets",
        "cashFlowExpenses",
        "cashFlowGrowth",
        "cashFlowIncome",
        "cashFlowNet",
        "cashFlowSavings",
        "clientProfile",
        "cover",
        "entitiesBalanceSheet",
        "entityCashFlow",
        "estateFlow",
        "estateFlowChart",
        "estateGiftTax",
        "estateLiquidity",
        "estateSummary",
        "estateTransfer",
        "holdings",
        "incomeTaxAboveLine",
        "incomeTaxBelowLine",
        "incomeTaxBracketFederal",
        "incomeTaxBracketState",
        "incomeTaxFederal",
        "incomeTaxIncome",
        "incomeTaxOtherTaxes",
        "incomeTaxState",
        "lifeInsuranceSummary",
        "mapCashFlow",
        "mapGoals",
        "mapNetWorth",
        "medicareSummary",
        "monteCarlo",
        "observationsNextSteps",
        "planStory",
        "portfolioAnalysis",
        "retirementComparison",
        "retirementSummary",
        "scenarioChanges",
        "taxComparison",
        "taxSummary",
        "toc",
      ].sort(),
    );
  });
});

describe("registry — Plan Story page", () => {
  // The report's ONLY advisor-facing surface. Without this field the launcher
  // renders no options dialog for the page, so the chapter toggles, the
  // proposed-plan picker and the review panel — where every AI-written word is
  // read and approved — are all unreachable, and the deck prints whatever the
  // defaults say.
  it("registers an OptionsControl, the only route to the review panel", () => {
    expect(typeof PRESENTATION_PAGES.planStory.OptionsControl).toBe("function");
  });
});
