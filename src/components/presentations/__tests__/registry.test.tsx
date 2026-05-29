import { describe, it, expect } from "vitest";
import { cashFlowPage, PRESENTATION_PAGES } from "../registry";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "@/lib/presentations/types";

describe("registry — Cash Flow page", () => {
  it("validates its default options via optionsSchema", () => {
    expect(() => cashFlowPage.optionsSchema.parse(CASH_FLOW_PAGE_OPTIONS_DEFAULT))
      .not.toThrow();
  });

  it("summarizes its default options to 'Retirement only'", () => {
    expect(cashFlowPage.summarizeOptions(CASH_FLOW_PAGE_OPTIONS_DEFAULT))
      .toBe("Retirement only");
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

  it("is registered alongside the framing pages + every cash-flow drill + income-tax + estate page in PRESENTATION_PAGES", () => {
    expect(Object.keys(PRESENTATION_PAGES).sort()).toEqual(
      [
        "cashFlow",
        "cashFlowActivity",
        "cashFlowAssets",
        "cashFlowExpenses",
        "cashFlowGrowth",
        "cashFlowIncome",
        "cashFlowNet",
        "cashFlowSavings",
        "cover",
        "estateGiftTax",
        "estateLiquidity",
        "estateTransfer",
        "incomeTaxAboveLine",
        "incomeTaxBelowLine",
        "incomeTaxBracketFederal",
        "incomeTaxBracketState",
        "incomeTaxFederal",
        "incomeTaxIncome",
        "incomeTaxOtherTaxes",
        "incomeTaxState",
        "toc",
      ].sort(),
    );
  });
});
