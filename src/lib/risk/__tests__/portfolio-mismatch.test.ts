import { describe, it, expect } from "vitest";
import { describeMismatch, effectiveScenarioPortfolioId, describeBucketSource } from "../portfolio-mismatch";

describe("describeMismatch", () => {
  it("reports aligned when the scenario already uses the profile's portfolio", () => {
    const s = describeMismatch({
      compositeLevel: "moderate",
      profilePortfolioId: "pf-mod",
      scenarioPortfolioId: "pf-mod",
    });
    expect(s.kind).toBe("aligned");
  });

  it("reports a mismatch when the scenario points somewhere else", () => {
    const s = describeMismatch({
      compositeLevel: "moderate",
      profilePortfolioId: "pf-mod",
      scenarioPortfolioId: "pf-aggr",
    });
    expect(s.kind).toBe("mismatch");
    expect(s.kind === "mismatch" && s.applyToPortfolioId).toBe("pf-mod");
  });

  it("reports untagged when the firm has no portfolio at this rung", () => {
    const s = describeMismatch({
      compositeLevel: "moderate",
      profilePortfolioId: null,
      scenarioPortfolioId: "pf-aggr",
    });
    expect(s.kind).toBe("untagged");
  });

  it("reports no profile when the composite level is null", () => {
    const s = describeMismatch({
      compositeLevel: null,
      profilePortfolioId: null,
      scenarioPortfolioId: "pf-aggr",
    });
    expect(s.kind).toBe("no_profile");
  });
});

describe("effectiveScenarioPortfolioId", () => {
  it("returns the shared id when both buckets are cleanly driven by the same portfolio", () => {
    const id = effectiveScenarioPortfolioId({
      growthSourceTaxable: "model_portfolio",
      growthSourceRetirement: "model_portfolio",
      modelPortfolioIdTaxable: "pf-mod",
      modelPortfolioIdRetirement: "pf-mod",
    });
    expect(id).toBe("pf-mod");
  });

  it("returns null when there is no plan settings row", () => {
    expect(effectiveScenarioPortfolioId(null)).toBeNull();
  });

  it("returns null when the taxable bucket's growth source is not model_portfolio (stale id, Cause 1)", () => {
    // The engine ignores modelPortfolioIdTaxable whenever the source isn't
    // "model_portfolio" -- a stale id can sit in the column after the advisor
    // switches the assumptions UI back to a flat rate.
    const id = effectiveScenarioPortfolioId({
      growthSourceTaxable: "inflation",
      growthSourceRetirement: "model_portfolio",
      modelPortfolioIdTaxable: "pf-mod",
      modelPortfolioIdRetirement: "pf-mod",
    });
    expect(id).toBeNull();
  });

  it("returns null when the retirement bucket's growth source is not model_portfolio (Cause 1, symmetric)", () => {
    const id = effectiveScenarioPortfolioId({
      growthSourceTaxable: "model_portfolio",
      growthSourceRetirement: "custom",
      modelPortfolioIdTaxable: "pf-mod",
      modelPortfolioIdRetirement: "pf-mod",
    });
    expect(id).toBeNull();
  });

  it("returns null when the two buckets have drifted to different portfolios (Cause 2)", () => {
    // applyRiskPortfolioToScenario writes both buckets together, but the
    // assumptions UI exposes taxable and retirement as independent rows, so
    // they can drift apart after the fact.
    const id = effectiveScenarioPortfolioId({
      growthSourceTaxable: "model_portfolio",
      growthSourceRetirement: "model_portfolio",
      modelPortfolioIdTaxable: "pf-mod",
      modelPortfolioIdRetirement: "pf-aggr",
    });
    expect(id).toBeNull();
  });
});

describe("describeBucketSource", () => {
  const names = new Map([["pf-mod", "Balanced Growth"]]);

  it("names the portfolio when the bucket is driven by one", () => {
    expect(
      describeBucketSource({
        source: "model_portfolio",
        portfolioId: "pf-mod",
        customRate: null,
        portfolioNames: names,
      }),
    ).toBe("Balanced Growth");
  });

  it("renders a custom rate as a percentage to two places", () => {
    // decimal(5,4) comes back from Drizzle as a string, not a number.
    expect(
      describeBucketSource({
        source: "custom",
        portfolioId: null,
        customRate: "0.0600",
        portfolioNames: names,
      }),
    ).toBe("Custom 6.00%");
  });

  it("renders each non-portfolio source with its own word", () => {
    const at = (source: string) =>
      describeBucketSource({ source, portfolioId: null, customRate: null, portfolioNames: names });
    expect(at("inflation")).toBe("Inflation");
    expect(at("asset_mix")).toBe("Account asset mix");
    expect(at("holdings")).toBe("Holdings");
    expect(at("ticker_portfolio")).toBe("Ticker portfolio");
    expect(at("default")).toBe("Firm default");
  });

  it("says Unknown portfolio when a model_portfolio bucket has a null id", () => {
    // Reachable: model_portfolio_id_taxable is `on delete set null`, so
    // deleting the portfolio in CMA strands the enum over a null id.
    expect(
      describeBucketSource({
        source: "model_portfolio",
        portfolioId: null,
        customRate: null,
        portfolioNames: names,
      }),
    ).toBe("Unknown portfolio");
  });

  it("says Unknown portfolio when the id misses the name map", () => {
    expect(
      describeBucketSource({
        source: "model_portfolio",
        portfolioId: "pf-deleted",
        customRate: null,
        portfolioNames: names,
      }),
    ).toBe("Unknown portfolio");
  });

  it("falls back to Not set on an unrecognised source", () => {
    expect(
      describeBucketSource({
        source: "something_new",
        portfolioId: null,
        customRate: null,
        portfolioNames: names,
      }),
    ).toBe("Not set");
  });

  it("renders Custom with no figure when the rate is missing", () => {
    expect(
      describeBucketSource({
        source: "custom",
        portfolioId: null,
        customRate: null,
        portfolioNames: names,
      }),
    ).toBe("Custom");
  });
});
