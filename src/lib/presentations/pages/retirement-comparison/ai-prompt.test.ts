// src/lib/presentations/pages/retirement-comparison/ai-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildRetirementComparisonAiPrompt } from "./ai-prompt";
import type { ComparisonKpi, PortfolioMatrix } from "./types";

describe("buildRetirementComparisonAiPrompt", () => {
  const args = {
    householdName: "the Smith household",
    firstNames: "John and Jane",
    scenarioLabel: "Roth + Delay RE",
    baselineLabel: "Base Case",
    baselineIsBase: true,
    kpis: [
      { label: "Plan Confidence", base: "72%", scenario: "91%", deltaLabel: "+19 pts", direction: 1 as const },
      { label: "Ending Portfolio Assets", base: "$4.1M", scenario: "$5.3M", deltaLabel: "+$1.2M", direction: 1 as const },
    ],
    matrix: {
      baseRetirementYear: 2030, scenarioRetirementYear: 2028,
      baseEndYear: 2060, scenarioEndYear: 2060,
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

  it("keeps a Base Case prompt byte-identical, so stored hashes keep matching", () => {
    // ensure-ai-summaries preserves advisor-edited prose only while the hash
    // matches. These are the exact strings the pre-baseline prompt emitted.
    const { user } = buildRetirementComparisonAiPrompt(args);
    expect(user).toContain('Comparison: Base Case vs. "Roth + Delay RE".');
    expect(user).toContain("Key metrics (Base → Scenario):");
    expect(user).toContain("- Plan Confidence: Base 72% → Scenario 91% (+19 pts).");
    expect(user).toContain("Changes made in the scenario vs. the base plan:");
    expect(user).not.toContain("recorded against Base Case");
  });

  it("names a scenario baseline everywhere it used to say 'Base'", () => {
    const { user } = buildRetirementComparisonAiPrompt({
      ...args,
      baselineLabel: "Retire at 62",
      baselineIsBase: false,
    });
    expect(user).toContain('Comparison: "Retire at 62" vs. "Roth + Delay RE".');
    expect(user).toContain("Key metrics (Retire at 62 → Scenario):");
    expect(user).toContain("- Plan Confidence: Retire at 62 72% → Scenario 91% (+19 pts).");
    expect(user).not.toContain("Base 72%");
  });

  it("labels both change lists as recorded against Base Case", () => {
    const { system, user } = buildRetirementComparisonAiPrompt({
      ...args,
      baselineLabel: "Retire at 62",
      baselineIsBase: false,
      baselineChangeLines: ["Changed retirementAge on John: 65 → 62."],
    });
    expect(system).toContain("recorded against Base Case, not against each other");
    expect(user).toContain('Changes in "Retire at 62" vs. the base plan:');
    expect(user).toContain('Changes in "Roth + Delay RE" vs. the base plan:');
  });
});

const kpis: ComparisonKpi[] = [
  { label: "Plan Confidence", base: "73%", scenario: "91%", deltaLabel: "+18 pts", direction: 1 },
];
const matrix: PortfolioMatrix = {
  baseRetirementYear: 2045, scenarioRetirementYear: 2040,
  baseEndYear: 2070, scenarioEndYear: 2070,
  baseAtRetirement: { total: 1, cash: 0, retirement: 0, taxable: 0 },
  scenarioAtRetirement: { total: 1, cash: 0, retirement: 0, taxable: 0 },
  baseAtEnd: { total: 1, cash: 0, retirement: 0, taxable: 0 },
  scenarioAtEnd: { total: 1, cash: 0, retirement: 0, taxable: 0 },
};

describe("buildRetirementComparisonAiPrompt — max-spend & downside", () => {
  it("includes max-spend and downside lines when provided", () => {
    const { user } = buildRetirementComparisonAiPrompt({
      householdName: "the Smith household", firstNames: "Pat",
      scenarioLabel: "Delay + Roth", kpis, matrix,
      baselineLabel: "Base Case", baselineIsBase: true,
      changeLines: ["Delay retirement to 67"],
      maxSpend: { base: 90_000, scenario: 110_000 },
      downside: { baseEndP20: 100_000, scnEndP20: 400_000 },
      tone: "detailed", length: "medium", customInstructions: "",
    });
    expect(user).toContain("Maximum sustainable retirement spending");
    expect(user).toContain("Downside (poor-market) ending balance");
    expect(user).toContain("Delay retirement to 67");
  });

  it("omits the new lines when not provided (back-compat)", () => {
    const { user } = buildRetirementComparisonAiPrompt({
      householdName: "h", firstNames: "p", scenarioLabel: "s", kpis, matrix,
      baselineLabel: "Base Case", baselineIsBase: true,
      changeLines: [], tone: "concise", length: "short", customInstructions: "",
    });
    expect(user).not.toContain("Maximum sustainable retirement spending");
  });
});

// ── The legacy block ─────────────────────────────────────────────────────────
//
// The commentary used to narrate the end-of-life PORTFOLIO as the inheritance,
// which reported a Roth conversion as destroying $1.6M of legacy on a real
// deck — the conversion was pre-paying the heirs' income tax, so the portfolio
// fell while what the heirs receive barely moved. The prompt therefore carries
// BOTH quantities and the tax that separates them, and says outright that they
// are not the same number.
describe("buildRetirementComparisonAiPrompt — legacy after tax", () => {
  const legacyArgs = {
    householdName: "the Smith household",
    firstNames: "Pat",
    scenarioLabel: "Roth conversion",
    baselineLabel: "Base Case",
    baselineIsBase: true,
    kpis,
    // Gross falls 8.9M → 7.3M; net to heirs is flat. That is the whole point.
    matrix: {
      ...matrix,
      baseAtEnd: { total: 8_900_000, cash: 0, retirement: 0, taxable: 0 },
      scenarioAtEnd: { total: 7_300_000, cash: 0, retirement: 0, taxable: 0 },
    },
    changeLines: ["Added: Roth Conversion Strategy."],
    legacy: {
      base: { toHeirs: 7_316_601, taxesAndCosts: 1_405_455, ird: 1_285_270 },
      scenario: { toHeirs: 7_283_822, taxesAndCosts: 0, ird: 0 },
    },
    tone: "detailed" as const,
    length: "medium" as const,
    customInstructions: "",
  };

  it("carries the gross portfolio, the tax, the IRD split and the net to heirs", () => {
    const { user } = buildRetirementComparisonAiPrompt(legacyArgs);
    expect(user).toContain("What the heirs actually receive (after tax)");
    // Gross on both sides — still stated, so the model can contrast them.
    expect(user).toContain("$8.9M");
    expect(user).toContain("$7.3M");
    // The tax that separates gross from net, with IRD named separately.
    expect(user).toContain("$1.4M");
    expect(user).toContain("$1.3M");
    // The move in what the heirs receive is the small one, not the $1.6M drop
    // in the portfolio.
    expect(user).toContain("Change in what the heirs receive: −$33K");
    expect(user).not.toContain("Change in what the heirs receive: −$1.6M");
  });

  it("tells the model the two quantities are not interchangeable", () => {
    const { system } = buildRetirementComparisonAiPrompt(legacyArgs);
    expect(system).toContain("NOT interchangeable");
    expect(system).toContain("income tax an heir owes on inherited pre-tax retirement accounts");
  });

  it("signs a rise in what the heirs receive", () => {
    const { user } = buildRetirementComparisonAiPrompt({
      ...legacyArgs,
      legacy: {
        base: { toHeirs: 7_316_601, taxesAndCosts: 1_405_455, ird: 1_285_270 },
        scenario: { toHeirs: 9_655_521, taxesAndCosts: 809_424, ird: 769_749 },
      },
    });
    expect(user).toContain("Change in what the heirs receive: +$2.3M");
  });

  it("omits the block and its guardrail when the plan has no estate model", () => {
    const { system, user } = buildRetirementComparisonAiPrompt({
      householdName: "h", firstNames: "p", scenarioLabel: "s",
      baselineLabel: "Base Case", baselineIsBase: true, kpis, matrix,
      changeLines: [], tone: "concise", length: "short", customInstructions: "",
    });
    expect(user).not.toContain("What the heirs actually receive");
    expect(system).not.toContain("NOT interchangeable");
  });
  // The legacy block arrived on main while the baseline picker was on a branch,
  // so it hard-coded "Base" for the left side. Every other line on this prompt
  // uses the chosen baseline's name; if this one does not, the sheet tells the
  // model that the left column is Base Case while the KPIs above say otherwise.
  it("names the chosen baseline in the legacy block, not \"Base\"", () => {
    const { user } = buildRetirementComparisonAiPrompt({
      ...legacyArgs,
      baselineLabel: "Retire at 62",
      baselineIsBase: false,
    });
    expect(user).toContain("- Retire at 62: portfolio");
    expect(user).not.toContain("- Base: portfolio");
  });
});
