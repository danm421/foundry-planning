import { describe, it, expect } from "vitest";
import { buildInvestmentProposalData } from "../view-model";
import { INVESTMENT_PROPOSAL_OPTIONS_DEFAULT } from "../options-schema";
import { estimateInvestmentProposalPageCount } from "../estimate-page-count";
import { BUNDLE } from "./fixtures/snapshot";

const OPTIONS = INVESTMENT_PROPOSAL_OPTIONS_DEFAULT;

describe("buildInvestmentProposalData", () => {
  it("marks the page empty when no proposal is picked", () => {
    const data = buildInvestmentProposalData(undefined, OPTIONS);
    expect(data.isEmpty).toBe(true);
    expect(data.emptyMessage).toBe("No proposal selected for this page.");
    expect(data.sections).toEqual([]);
  });

  it("marks the page empty — not broken — when the proposal was deleted", () => {
    const data = buildInvestmentProposalData(undefined, { ...OPTIONS, proposalId: "gone" });
    expect(data.isEmpty).toBe(true);
    expect(data.emptyMessage).toBe(
      "The proposal this page pointed at is no longer available. Pick another in the builder.",
    );
  });

  it("still lists the reserved sheets when the proposal was deleted, so the deck stays numbered", () => {
    const options = { ...OPTIONS, proposalId: "gone" };
    const data = buildInvestmentProposalData(undefined, options);
    expect(data.sections).toHaveLength(
      estimateInvestmentProposalPageCount(undefined, options),
    );
  });

  it("prints the proposal's name, target and as-of stamp", () => {
    const data = buildInvestmentProposalData(BUNDLE, OPTIONS);
    expect(data.isEmpty).toBe(false);
    expect(data.title).toBe("Move to the core model");
    expect(data.subtitle).toBe("60/40 Core");
    expect(data.asOf).toBe("2026-08-12T23:44:00.000Z");
  });

  it("emits exactly the enabled sections, in print order", () => {
    const data = buildInvestmentProposalData(BUNDLE, {
      ...OPTIONS,
      sections: { ...OPTIONS.sections, allocation: false, commentary: false },
    });
    expect(data.sections).toEqual([
      "verdict", "riskReturn", "suitability", "growth",
      "stress", "outcomes", "fees", "transition", "holdings",
    ]);
  });

  it("builds the verdict from the frozen snapshot alone", () => {
    const { verdict } = buildInvestmentProposalData(BUNDLE, OPTIONS);
    expect(verdict.deltaReturn).toBeCloseTo(0.034, 10);
    expect(verdict.deltaVolatility).toBeCloseTo(0.077, 10);
    expect(verdict.estimatedTax).toBe(36911);
    expect(verdict.annualDollarsSaved).toBe(243);
    expect(verdict.headline).toBe(
      "Earned back in about 5.7 years — the tax cost is expected to be recovered within the horizon shown.",
    );
  });

  it("writes a no-break-even headline rather than a number when there is no benefit", () => {
    const noBenefit = {
      ...BUNDLE,
      snapshot: {
        ...BUNDLE.snapshot,
        breakEven: { estimatedTax: 36911, annualBenefit: -100, years: null, verdict: "no_benefit" as const },
      },
    };
    const { verdict } = buildInvestmentProposalData(noBenefit, OPTIONS);
    expect(verdict.headline).toBe(
      "No break-even — the proposal is not expected to out-earn the current portfolio after fees, so the tax cost is never earned back.",
    );
  });

  it("keeps only the stress windows that have data, and says why the others are missing", () => {
    const data = buildInvestmentProposalData(BUNDLE, OPTIONS);
    expect(data.stress.available.map((w) => w.key)).toEqual(["covid"]);
    expect(data.stress.unavailable).toEqual([
      { label: "Global financial crisis", reason: "One or more holdings launched after this period." },
    ]);
  });

  it("carries the two donuts and the scatter", () => {
    const data = buildInvestmentProposalData(BUNDLE, OPTIONS);
    expect(data.donuts.current.centerLabel).toBe("Current");
    expect(data.donuts.proposed.centerLabel).toBe("Proposed");
    expect(data.scatter.points).toHaveLength(2);
  });

  it("passes the advisor's commentary text through untouched", () => {
    const data = buildInvestmentProposalData(BUNDLE, {
      ...OPTIONS,
      ai: { ...OPTIONS.ai, generatedText: "Hand-edited copy." },
    });
    expect(data.commentary).toBe("Hand-edited copy.");
  });
});
