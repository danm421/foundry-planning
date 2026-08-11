import { describe, it, expect } from "vitest";
import { buildChapterPrompt } from "../prompts";
import { CHAPTERS } from "../registry";
import { moneyFact, pctFact } from "../../facts";
import type { StoryContext } from "../../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Retire at 62 + Roth",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [{ name: "Delay Social Security", rows: [{ area: "Income", what: "Alan's Social Security", op: "edit", before: "67", after: "70", detail: ["Claiming age moves from 67 to 70"] }] }],
  facts: [pctFact("outcome.confidence.proposed", "Confidence, proposed", 0.91), moneyFact("today.netWorth", "Net worth", 2_100_000)],
};

describe("buildChapterPrompt", () => {
  it("lists every allowed figure with its label, and forbids inventing others", () => {
    const { system, user } = buildChapterPrompt("planInOnePage", CTX, [], []);
    expect(user).toContain("Confidence, proposed: 91%");
    expect(user).toContain("Net worth: $2.1M");
    expect(system).toContain("Only use the figures listed");
  });

  it("names the household and the scenario", () => {
    const { user } = buildChapterPrompt("planInOnePage", CTX, [], []);
    expect(user).toContain("Alan and Teresa");
    expect(user).toContain("Retire at 62 + Roth");
  });

  it("includes the strategies for the recommendation chapter", () => {
    const { user } = buildChapterPrompt("whatWeRecommend", CTX, [], []);
    expect(user).toContain("Delay Social Security");
    expect(user).toContain("Claiming age moves from 67 to 70");
  });

  it("tells the model to point forward in frontMatter mode", () => {
    const { system } = buildChapterPrompt("planInOnePage", { ...CTX, documentRole: "frontMatter" }, [], []);
    expect(system).toContain("pages that follow");
  });

  it("includes voice samples as style examples when supplied", () => {
    const { system } = buildChapterPrompt("planInOnePage", CTX, ["We kept this simple on purpose."], []);
    expect(system).toContain("We kept this simple on purpose.");
  });

  it("names every broken rule on a retry", () => {
    const { user } = buildChapterPrompt("planInOnePage", CTX, [], [
      { gate: "facts", message: "The figure $3.4M is not one of the supplied plan figures." },
      { gate: "voice", message: "Drop the three-item parallel list." },
    ]);
    expect(user).toContain("$3.4M");
    expect(user).toContain("three-item");
  });

  // Gate 3 rejects any clause that OPENS with an action verb, and it applies no
  // object test in that position — so "Sell the rental", an advisor's own name
  // for a toggle group, fails the gate for words the model did not choose. The
  // label still has to reach the model (it is how the changes are grouped), so
  // the prompt supplies it and forbids reproducing it.
  it("supplies a verb-initial strategy label but forbids quoting it", () => {
    const ctx: StoryContext = {
      ...CTX,
      strategies: [{ name: "Sell the rental", rows: [{ area: "Assets", what: "Rental property", op: "remove", before: "In plan", after: "—", detail: ["Sold in 2029"] }] }],
    };
    const { system, user } = buildChapterPrompt("whatWeRecommend", ctx, [], []);
    expect(user).toContain("Sell the rental");
    expect(system).toContain("never repeat a label word for word");
  });

  it("leaves no heading standing over an empty list", () => {
    const { user } = buildChapterPrompt("whatWeRecommend", { ...CTX, strategies: [], facts: [] }, [], []);
    expect(user).not.toContain("The changes, grouped as strategies");
    expect(user).not.toMatch(/figures you may use:\n\n/u);
  });
});

describe("CHAPTERS", () => {
  it("gives every chapter a title, a layout, and a fallback narrator", () => {
    for (const def of Object.values(CHAPTERS)) {
      expect(def.title.length).toBeGreaterThan(0);
      expect(["heroProse", "strategyCards"]).toContain(def.layout);
      expect(typeof def.narrate).toBe("function");
    }
  });
});
