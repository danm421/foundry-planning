import { describe, it, expect } from "vitest";
import { portfolioAnalysisOptionsSchema, PORTFOLIO_ANALYSIS_OPTIONS_DEFAULT } from "../options-schema";
import { summarizePortfolioAnalysisOptions } from "../summarize-options";
import { defaultAnalysisSelection } from "../default-selection";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";

describe("portfolioAnalysisOptionsSchema", () => {
  it("accepts the default options", () => {
    expect(portfolioAnalysisOptionsSchema.parse(PORTFOLIO_ANALYSIS_OPTIONS_DEFAULT)).toEqual(PORTFOLIO_ANALYSIS_OPTIONS_DEFAULT);
  });
  it("rejects an unknown sortKey", () => {
    expect(() => portfolioAnalysisOptionsSchema.parse({ ...PORTFOLIO_ANALYSIS_OPTIONS_DEFAULT, sortKey: "nope" })).toThrow();
  });
});

describe("defaultAnalysisSelection", () => {
  it("selects asset classes + categories + model portfolios, not individual accounts", () => {
    const rows = [
      { key: "asset_class:eq", type: "asset_class" },
      { key: "category:taxable", type: "category" },
      { key: "model_portfolio:mp1", type: "model_portfolio" },
      { key: "account:a1", type: "account" },
    ] as AnalysisRow[];
    expect(defaultAnalysisSelection(rows).sort()).toEqual(
      ["asset_class:eq", "category:taxable", "model_portfolio:mp1"].sort(),
    );
  });
});

describe("summarizePortfolioAnalysisOptions", () => {
  it("summarizes count + sort", () => {
    const s = summarizePortfolioAnalysisOptions({ selectedKeys: ["a", "b"], sortKey: "stdDev", sortDir: "asc" });
    expect(s).toContain("2");
  });
});
