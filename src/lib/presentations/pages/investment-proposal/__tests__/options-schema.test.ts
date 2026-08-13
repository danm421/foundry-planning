import { describe, it, expect } from "vitest";
import {
  investmentProposalOptionsSchema,
  INVESTMENT_PROPOSAL_OPTIONS_DEFAULT,
  SECTION_IDS,
  printedSections,
} from "../options-schema";
import { summarizeInvestmentProposalOptions } from "../summarize-options";
import { estimateInvestmentProposalPageCount } from "../estimate-page-count";

describe("investmentProposalOptionsSchema", () => {
  it("defaults every section on and the proposal unpicked", () => {
    const parsed = investmentProposalOptionsSchema.parse({});
    expect(parsed.proposalId).toBe("");
    expect(parsed.tone).toBe("plain");
    expect(parsed.length).toBe("medium");
    for (const id of SECTION_IDS) expect(parsed.sections[id]).toBe(true);
  });

  it("keeps a partially specified sections object defaulting the rest on", () => {
    const parsed = investmentProposalOptionsSchema.parse({ sections: { commentary: false } });
    expect(parsed.sections.commentary).toBe(false);
    expect(parsed.sections.verdict).toBe(true);
  });
});

describe("printedSections", () => {
  it("returns enabled sections in print order", () => {
    const options = {
      ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT,
      sections: { ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT.sections, allocation: false, stress: false },
    };
    expect(printedSections(options)).toEqual([
      "verdict", "riskReturn", "suitability", "growth",
      "outcomes", "fees", "transition", "commentary", "holdings",
    ]);
  });
});

describe("estimateInvestmentProposalPageCount", () => {
  it("is one sheet per enabled section", () => {
    expect(estimateInvestmentProposalPageCount(undefined, INVESTMENT_PROPOSAL_OPTIONS_DEFAULT)).toBe(11);
  });

  it("floors at one so an all-off report still numbers the empty-state sheet", () => {
    const off = Object.fromEntries(SECTION_IDS.map((id) => [id, false]));
    const options = { ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, sections: off } as typeof INVESTMENT_PROPOSAL_OPTIONS_DEFAULT;
    expect(estimateInvestmentProposalPageCount(undefined, options)).toBe(1);
  });

  it("reads options only — identical for any data argument", () => {
    const a = estimateInvestmentProposalPageCount(undefined, INVESTMENT_PROPOSAL_OPTIONS_DEFAULT);
    const b = estimateInvestmentProposalPageCount({ anything: true }, INVESTMENT_PROPOSAL_OPTIONS_DEFAULT);
    expect(a).toBe(b);
  });
});

describe("summarizeInvestmentProposalOptions", () => {
  it("says how many sections print and that no proposal is picked", () => {
    expect(summarizeInvestmentProposalOptions(INVESTMENT_PROPOSAL_OPTIONS_DEFAULT)).toBe(
      "no proposal picked · 11 sections",
    );
  });

  it("names the picked state once a proposal id is set", () => {
    const options = { ...INVESTMENT_PROPOSAL_OPTIONS_DEFAULT, proposalId: "abc" };
    expect(summarizeInvestmentProposalOptions(options)).toBe("1 proposal · 11 sections");
  });
});
