// The Solver's "what does this account grow at?" picker. Its job is to keep the
// dropdown honest about the source the account is ACTUALLY on, and to hand the
// caller every field a save needs — the resolved rate, the tax realization, and
// the BASIS (source + portfolio id) that makes the rate survive a reload.

import { describe, it, expect } from "vitest";
import type { SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import {
  CATEGORY_DEFAULT,
  accountGrowthSelectValue,
  resolveAccountGrowthChoice,
} from "../solver-account-growth-select";

const BALANCED: SolverModelPortfolio = {
  id: "pf-balanced",
  name: "Balanced 60/40",
  growthRate: 0.062,
  realization: {
    pctOrdinaryIncome: 0.2,
    pctLtCapitalGains: 0.5,
    pctQualifiedDividends: 0.25,
    pctTaxExempt: 0.05,
    turnoverPct: 0,
  },
  mix: [{ assetClassId: "ac-equity", weight: 0.6 }],
};
const PORTFOLIOS = [BALANCED];

describe("resolveAccountGrowthChoice", () => {
  it("carries the portfolio's rate, realization, mix AND basis", () => {
    const choice = resolveAccountGrowthChoice("pf-balanced", PORTFOLIOS, 0.05)!;
    expect(choice.growthRate).toBe(0.062);
    expect(choice.realization).toEqual(BALANCED.realization);
    expect(choice.mix).toEqual(BALANCED.mix);
    // The basis is what makes it stick: an account saved with only a rate and
    // the column default re-derives its growth from the category on next load.
    expect(choice.growthSource).toBe("model_portfolio");
    expect(choice.modelPortfolioId).toBe("pf-balanced");
  });

  it("resolves the plan default to the category rate with no portfolio link", () => {
    const choice = resolveAccountGrowthChoice(CATEGORY_DEFAULT, PORTFOLIOS, 0.05)!;
    expect(choice.growthRate).toBe(0.05);
    expect(choice.growthSource).toBe("default");
    expect(choice.modelPortfolioId).toBeNull();
    expect(choice.mix).toEqual([]);
  });

  it("returns null for a portfolio that no longer exists rather than 0% growth", () => {
    expect(resolveAccountGrowthChoice("pf-deleted", PORTFOLIOS, 0.05)).toBeNull();
  });

  it("refuses a Plan-default pick it cannot price", () => {
    // Real-estate / business accounts reach the dialog with no threaded
    // default. Pricing "Plan default" off the account's own current rate would
    // label a number that is not the plan's default.
    expect(resolveAccountGrowthChoice(CATEGORY_DEFAULT, PORTFOLIOS, null)).toBeNull();
  });
});

describe("accountGrowthSelectValue", () => {
  it("selects the account's own portfolio", () => {
    expect(
      accountGrowthSelectValue(
        { growthSource: "model_portfolio", modelPortfolioId: "pf-balanced" },
        PORTFOLIOS,
        0.05,
      ),
    ).toBe("pf-balanced");
  });

  it("treats a missing source as the plan default", () => {
    expect(accountGrowthSelectValue({}, PORTFOLIOS, 0.05)).toBe(CATEGORY_DEFAULT);
  });

  it("refuses to claim 'Plan default' for an account on a source it cannot offer", () => {
    // A <select> whose value matches no option renders the FIRST one. Returning
    // "default" here would show "Plan default" for an account actually on a
    // custom rate or its own asset mix — and the next save would write that lie.
    expect(accountGrowthSelectValue({ growthSource: "custom" }, PORTFOLIOS, 0.05)).toBeNull();
    expect(accountGrowthSelectValue({ growthSource: "asset_mix" }, PORTFOLIOS, 0.05)).toBeNull();
    expect(
      accountGrowthSelectValue(
        { growthSource: "model_portfolio", modelPortfolioId: "pf-from-another-firm" },
        PORTFOLIOS,
        0.05,
      ),
    ).toBeNull();
  });

  it("does not preselect an option the picker will not render", () => {
    expect(accountGrowthSelectValue({}, PORTFOLIOS, null)).toBeNull();
  });
});
