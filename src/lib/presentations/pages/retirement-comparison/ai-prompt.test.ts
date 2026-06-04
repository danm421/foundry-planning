// src/lib/presentations/pages/retirement-comparison/ai-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildRetirementComparisonAiPrompt } from "./ai-prompt";

describe("buildRetirementComparisonAiPrompt", () => {
  const args = {
    householdName: "the Smith household",
    firstNames: "John and Jane",
    scenarioLabel: "Roth + Delay RE",
    kpis: [
      { label: "Probability of Success", base: "72%", scenario: "91%", deltaLabel: "+19 pts", direction: 1 as const },
      { label: "Ending Portfolio Assets", base: "$4.1M", scenario: "$5.3M", deltaLabel: "+$1.2M", direction: 1 as const },
    ],
    matrix: {
      retirementYear: 2028, endOfLifeYear: 2060,
      baseAtRetirement: { total: 4_100_000, cash: 1, retirement: 1, taxable: 1 },
      scenarioAtRetirement: { total: 4_300_000, cash: 1, retirement: 1, taxable: 1 },
      baseAtEnd: { total: 2_000_000, cash: 1, retirement: 1, taxable: 1 },
      scenarioAtEnd: { total: 5_300_000, cash: 1, retirement: 1, taxable: 1 },
    },
    changeLines: ["Changed retirementAge on John: 65 → 62.", "Added: Roth Conversion Strategy."],
    tone: "detailed" as const,
    length: "medium" as const,
    customInstructions: "",
  };

  it("includes the guardrails, the scenario label, and the PoS delta", () => {
    const { system, user } = buildRetirementComparisonAiPrompt(args);
    expect(system).toContain("clean Markdown only");
    expect(system).toContain("Only use numbers from the data below");
    expect(user).toContain("Roth + Delay RE");
    expect(user).toContain("+19 pts");
    expect(user).toContain("Roth Conversion Strategy");
  });

  it("appends advisor instructions when present", () => {
    const { system } = buildRetirementComparisonAiPrompt({ ...args, customInstructions: "Mention the legacy goal." });
    expect(system).toContain("Advisor instructions: Mention the legacy goal.");
  });
});
