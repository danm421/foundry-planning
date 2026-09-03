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
  heirTaxes: [
    { name: "Base Case", amount: 412_000 },
    { name: "Retire at 62", amount: 180_000 },
  ],
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

  it("carries the inherited-asset tax block and the instruction that reads it", () => {
    const { system, user } = buildScenarioComparisonAiPrompt(args);
    expect(user).toContain("Base Case: $412k");
    expect(user).toContain("already deducted from the Net to heirs row");
    expect(system).toContain("ALREADY NET of it");
  });

  it("reads a $0 column as a result once another column carries the tax", () => {
    // The defect this rule exists for: a plan that converts everything leaves
    // the heirs nothing taxable, and v2 printed that as "no heir income tax
    // was modeled in this column" — its best legacy outcome, reported as a gap.
    const { system, user } = buildScenarioComparisonAiPrompt({
      ...args,
      heirTaxes: [
        { name: "Base Case", amount: 412_000 },
        { name: "Convert it all", amount: 0 },
      ],
    });
    expect(user).toContain("Convert it all: $0");
    expect(system).toContain("A column showing $0 means the heirs owe no income tax");
    // And it must say so as a fact about their money. Told what NOT to call the
    // figure, the model printed the denial verbatim ("a true result, not a
    // missing estimate") — report-talk in a client-facing paragraph.
    expect(system).toContain("Write about the household's money, never about the report");
  });

  it("drops the block when no column's figure is above zero", () => {
    // All-$0 cannot distinguish "nothing pre-tax passes" from "this household
    // has no inherited-asset tax rate set", so neither sentence is licensed.
    for (const heirTaxes of [
      [],
      [{ name: "Base Case", amount: null }, { name: "Retire at 62", amount: null }],
      [{ name: "Base Case", amount: 0 }, { name: "Retire at 62", amount: 0 }],
    ]) {
      const { system, user } = buildScenarioComparisonAiPrompt({ ...args, heirTaxes });
      expect(user).not.toContain("already deducted from the Net to heirs row");
      expect(system).not.toContain("ALREADY NET of it");
    }
  });

  it("prints an unreadable column as unavailable beside the ones it has", () => {
    const { user } = buildScenarioComparisonAiPrompt({
      ...args,
      heirTaxes: [
        { name: "Base Case", amount: 412_000 },
        { name: "Retire at 62", amount: null },
      ],
    });
    expect(user).toContain("Retire at 62: unavailable");
  });

  it("tells the model the gains and costs strip is already printed", () => {
    // The strip prints verbatim under the paragraph; re-listing it is what the
    // narratives were spending their sentence budget on.
    expect(buildScenarioComparisonAiPrompt(args).system)
      .toContain("ALREADY PRINTED");
  });

  it("names the tax character of what the heirs inherit as a mechanism to explain", () => {
    const { system } = buildScenarioComparisonAiPrompt(args);
    expect(system).toMatch(/Roth balance passes to heirs income-tax-free/);
    expect(system).toMatch(/heirs owe ordinary income tax as they draw it down/);
    // …and it must not license naming a mechanism a scenario never makes.
    expect(system).toContain("ONLY when this scenario's own change list contains the change");
  });

  it("falls back to a placeholder line when a band has no changes", () => {
    const noChangesBand = { ...band, changeLines: [] };
    const { user } = buildScenarioComparisonAiPrompt({ ...args, bands: [noChangesBand] });
    expect(user).toContain("(No changes recorded.)");
  });
});

describe("hashBand", () => {
  const base = {
    scenarioId: "s1", name: "Retire at 62", gains: band.gains, costs: band.costs,
    changeLines: band.changeLines, tone: "detailed", customInstructions: "",
    sentenceBudget: 3, heirIncomeTax: 412_000,
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

  it("changes when only the scenario's display name changes", () => {
    expect(hashBand({ ...base, name: "Retire at 65" })).not.toBe(hashBand(base));
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

  it("changes when this column's inherited-asset tax moves", () => {
    expect(hashBand({ ...base, heirIncomeTax: 180_000 })).not.toBe(hashBand(base));
  });

  it("separates a zero figure from an absent one", () => {
    // $0 beside a taxed column licenses "your heirs owe nothing on this"; null
    // is a column with no estate report and licenses nothing. Different
    // sentences, so they must not collapse to the same hash.
    expect(hashBand({ ...base, heirIncomeTax: 0 }))
      .not.toBe(hashBand({ ...base, heirIncomeTax: null }));
  });
});

describe("NarrativesSchema", () => {
  it("parses a well-formed response", () => {
    expect(() =>
      NarrativesSchema.parse({ narratives: [{ scenarioId: "s1", paragraph: "Text." }] }),
    ).not.toThrow();
  });
});
