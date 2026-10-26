import { describe, it, expect } from "vitest";
import { cashFlowPage, PRESENTATION_PAGES } from "../registry";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "@/lib/presentations/types";
import { DrillOptionsControl, TaxBracketOptionsControl } from "../shared/drill-options-control";

describe("registry — Tax Bracket pages", () => {
  it("alone offer the Roth conversion years range", () => {
    expect(PRESENTATION_PAGES.incomeTaxBracketFederal.OptionsControl).toBe(TaxBracketOptionsControl);
    expect(PRESENTATION_PAGES.incomeTaxBracketState.OptionsControl).toBe(TaxBracketOptionsControl);
    expect(PRESENTATION_PAGES.incomeTaxFederal.OptionsControl).toBe(DrillOptionsControl);
  });

  it("accept and label that range", () => {
    const page = PRESENTATION_PAGES.incomeTaxBracketFederal;
    const opts = page.optionsSchema.parse({ range: "rothConversionYears", showCallout: false });
    expect(page.summarizeOptions(opts)).toBe("Roth conversion years");
  });
});

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
        "balanceSheetReport",
        "blank",
        "cashFlow",
        "cashFlowActivity",
        "cashFlowAssets",
        "cashFlowExpenses",
        "cashFlowGrowth",
        "cashFlowIncome",
        "cashFlowMonthly",
        "cashFlowNet",
        "cashFlowSavings",
        "cashFlowWithdrawals",
        "clientProfile",
        "cover",
        "earlyYearsDebtOrInvest",
        "earlyYearsHumanCapital",
        "earlyYearsLadder",
        "earlyYearsRoth",
        "earlyYearsStanding",
        "earlyYearsTidbits",
        "earlyYearsWaiting",
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
        "investmentProposal",
        "incomeTaxState",
        "liabilityAmortization",
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
        "rothConversion",
        "scenarioChanges",
        "scenarioComparison",
        "solverCashFlow",
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

describe("registry — balance sheet pages", () => {
  // Saved decks and templates store page ids, so the old page keeps its id and
  // only its name moves; the report-style sheet takes "Balance Sheet".
  it("names the Assets report's sheet Balance Sheet and the summary sheets Net Worth", () => {
    expect(PRESENTATION_PAGES.balanceSheetReport.title).toBe("Balance Sheet");
    expect(PRESENTATION_PAGES.balanceSheet.title).toBe("Net Worth");
    expect(PRESENTATION_PAGES.entitiesBalanceSheet.title).toBe("Net Worth — Entities");
  });

  it("files Balance Sheet under Assets with a scenario picker and options", () => {
    const page = PRESENTATION_PAGES.balanceSheetReport;
    expect(page.category).toBe("Assets");
    expect(page.supportsScenarioOverride).toBe(true);
    expect(typeof page.OptionsControl).toBe("function");
  });
});
