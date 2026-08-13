import { describe, it, expect } from "vitest";
import { buildInvestmentProposalAiPrompt } from "../ai-prompt";
import { BUNDLE } from "./fixtures/snapshot";

const ARGS = {
  firstNames: "Cooper and Susan",
  proposalName: BUNDLE.name,
  targetLabel: BUNDLE.targetLabel,
  snapshot: BUNDLE.snapshot,
  tone: "plain" as const,
  length: "medium" as const,
  customInstructions: "",
};

describe("buildInvestmentProposalAiPrompt", () => {
  it("forbids inventing figures and forbids promising outcomes", () => {
    const { system } = buildInvestmentProposalAiPrompt(ARGS);
    expect(system).toContain("Only use numbers from the data below. Never invent figures.");
    expect(system).toContain("Never promise or guarantee an outcome.");
  });

  it("requires the tax cost and the break-even to be named", () => {
    const { system } = buildInvestmentProposalAiPrompt(ARGS);
    expect(system).toContain("You MUST name the tax cost of switching and the break-even");
  });

  it("puts the frozen figures the page prints into the user prompt", () => {
    const { user } = buildInvestmentProposalAiPrompt(ARGS);
    expect(user).toContain("Estimated tax to switch: $36,911");
    expect(user).toContain("Break-even: about 5.7 years");
    expect(user).toContain("Blended fund cost: 0.23% now, 0.10% proposed");
  });

  it("states plainly when there is no break-even", () => {
    const { user } = buildInvestmentProposalAiPrompt({
      ...ARGS,
      snapshot: {
        ...BUNDLE.snapshot,
        breakEven: { estimatedTax: 36911, annualBenefit: -100, years: null, verdict: "no_benefit" as const },
      },
    });
    expect(user).toContain("Break-even: none — the proposal is not expected to out-earn");
  });

  it("appends the advisor's custom instructions verbatim", () => {
    const { user } = buildInvestmentProposalAiPrompt({ ...ARGS, customInstructions: "Mention the 529." });
    expect(user).toContain("Mention the 529.");
  });

  it("changes the prompt when tone or length changes, so the cache key changes too", () => {
    const a = buildInvestmentProposalAiPrompt(ARGS);
    const b = buildInvestmentProposalAiPrompt({ ...ARGS, tone: "concise" });
    expect(a.system).not.toBe(b.system);
  });
});
