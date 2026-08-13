import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES, CATEGORY_ORDER } from "../registry";
import { INVESTMENT_PROPOSAL_OPTIONS_DEFAULT } from "@/lib/presentations/pages/investment-proposal/options-schema";
import { BUNDLE } from "@/lib/presentations/pages/investment-proposal/__tests__/fixtures/snapshot";

const page = PRESENTATION_PAGES.investmentProposal;

describe("investmentProposalPage", () => {
  it("is registered under Assets and adds no new category", () => {
    expect(page.category).toBe("Assets");
    expect(CATEGORY_ORDER).toEqual([
      "Framing", "Cash Flow", "Income Tax", "Assets",
      "Insurance", "Estate", "Monte Carlo", "Comparison", "Retirement",
    ]);
  });

  it("declares no scenario dimension", () => {
    expect(page.supportsScenarioOverride).toBe(false);
    expect(page.inlineScenarioOption).toBeUndefined();
  });

  it("renders the empty state when the context carries no proposal", () => {
    const data = page.buildData(
      { clientName: "Cooper Sample" } as never,
      INVESTMENT_PROPOSAL_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(true);
  });

  it("builds real data from a context-supplied bundle", () => {
    const data = page.buildData(
      { clientName: "Cooper Sample", proposal: BUNDLE } as never,
      INVESTMENT_PROPOSAL_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(false);
    expect(data.title).toBe("Move to the core model");
  });

  it("estimates the deck's sheets from options alone", () => {
    const picked = { ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, proposalId: "p1" };
    expect(page.estimatePageCount(undefined as never, picked)).toBe(11);
    // Unpicked reserves one sheet, because the renderer prints one. See the
    // header comment on `estimate-page-count.ts`.
    expect(page.estimatePageCount(undefined as never, INVESTMENT_PROPOSAL_OPTIONS_DEFAULT)).toBe(1);
  });
});
