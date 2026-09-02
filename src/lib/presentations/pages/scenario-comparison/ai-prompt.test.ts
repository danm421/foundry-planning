import { describe, it, expect } from "vitest";
import { buildScenarioComparisonAiPrompt, hashBand, NarrativesSchema } from "./ai-prompt";

const band = {
  scenarioId: "s1", name: "Retire at 62",
  changeLines: ["Retirement age 65 to 62"],
  gains: [{ label: "Plan confidence", amount: "+9 pts" }],
  costs: [{ label: "Lifetime taxes", amount: "+$142K" }],
};
const args = {
  householdName: "The Coopers", firstNames: "Alan & Teresa",
  tone: "detailed" as const, customInstructions: "", sentenceBudget: 3,
  bands: [band],
  matrixLines: ["Plan confidence: Base Case 73% | Retire at 62 82%"],
};

describe("buildScenarioComparisonAiPrompt", () => {
  it("names every scenario and carries its gains and costs", () => {
    const { user } = buildScenarioComparisonAiPrompt(args);
    expect(user).toContain("Retire at 62");
    expect(user).toContain("+9 pts");
    expect(user).toContain("+$142K");
    expect(user).toContain("Retirement age 65 to 62");
  });

  it("passes the scenarioId so responses can be matched by id", () => {
    expect(buildScenarioComparisonAiPrompt(args).user).toContain("s1");
  });

  it("states the sentence budget in the system prompt", () => {
    expect(buildScenarioComparisonAiPrompt(args).system).toContain("3 sentences");
  });

  it("forbids inventing figures", () => {
    expect(buildScenarioComparisonAiPrompt(args).system).toMatch(/never invent/i);
  });

  it("falls back to (none) when a band has no gains or costs", () => {
    const emptyBand = { ...band, gains: [], costs: [] };
    const { user } = buildScenarioComparisonAiPrompt({ ...args, bands: [emptyBand] });
    expect(user).toContain("Gains: (none)");
    expect(user).toContain("Costs: (none)");
  });

  it("falls back to a placeholder line when a band has no changes", () => {
    const noChangesBand = { ...band, changeLines: [] };
    const { user } = buildScenarioComparisonAiPrompt({ ...args, bands: [noChangesBand] });
    expect(user).toContain("(No changes recorded.)");
  });
});

describe("hashBand", () => {
  const base = {
    scenarioId: "s1", gains: band.gains, costs: band.costs,
    changeLines: band.changeLines, tone: "detailed", customInstructions: "",
    sentenceBudget: 3,
  };

  it("is stable for identical inputs", () => {
    expect(hashBand(base)).toBe(hashBand({ ...base }));
  });

  it("changes when this band's own numbers move", () => {
    expect(hashBand({ ...base, gains: [{ label: "Plan confidence", amount: "+12 pts" }] }))
      .not.toBe(hashBand(base));
  });

  it("changes when its costs move", () => {
    expect(hashBand({ ...base, costs: [{ label: "Lifetime taxes", amount: "+$200K" }] }))
      .not.toBe(hashBand(base));
  });

  it("changes when its change list moves", () => {
    expect(hashBand({ ...base, changeLines: ["Retirement age 65 to 61"] }))
      .not.toBe(hashBand(base));
  });

  it("changes when the tone changes", () => {
    expect(hashBand({ ...base, tone: "plain" })).not.toBe(hashBand(base));
  });

  it("changes when custom instructions change", () => {
    expect(hashBand({ ...base, customInstructions: "Be brief." })).not.toBe(hashBand(base));
  });

  it("changes when the sentence budget changes", () => {
    expect(hashBand({ ...base, sentenceBudget: 6 })).not.toBe(hashBand(base));
  });
});

describe("NarrativesSchema", () => {
  it("parses a well-formed response", () => {
    expect(() =>
      NarrativesSchema.parse({ narratives: [{ scenarioId: "s1", paragraph: "Text." }] }),
    ).not.toThrow();
  });
});
