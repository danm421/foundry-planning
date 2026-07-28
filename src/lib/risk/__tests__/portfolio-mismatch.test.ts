import { describe, it, expect } from "vitest";
import { describeMismatch, effectiveScenarioPortfolioId } from "../portfolio-mismatch";

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
