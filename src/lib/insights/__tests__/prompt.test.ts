import { describe, it, expect } from "vitest";
import { buildInsightsPrompt, parseInsightSections } from "../prompt";
import type { InsightsBattery } from "../battery";

const battery: InsightsBattery = {
  clientName: "Cooper Household",
  kpis: { netWorth: 2_000_000, liquidPortfolio: 1_200_000, yearsToRetirement: 5, mcSuccessRate: 0.9, fundingScore: 1.2 },
  risk: { currentPct: 78, requiredPct: 45, capacityPct: 60, capacityScore: 60, verdict: "over_risked" },
  needsAttention: [],
  grounding: { goalsText: "Retire at 65, fund grandkids' college", notesText: "Sells in downturns", allocation: [{ group: "equities", pct: 0.78 }] },
};

describe("buildInsightsPrompt", () => {
  it("grounds the prompt in real numbers and forbids invention", () => {
    const { system, user } = buildInsightsPrompt(battery);
    expect(system.toLowerCase()).toContain("do not invent");
    expect(user).toContain("78"); // current growth %
    expect(user).toContain("over_risked");
    expect(user).toContain("Retire at 65");
    expect(user).toContain("SNAPSHOT");
  });
});

describe("parseInsightSections", () => {
  it("splits the three headered sections", () => {
    const md = [
      "## SNAPSHOT", "A pre-retiree couple.", "",
      "## GOALS", "- Retire at 65", "",
      "## OPPORTUNITIES", "- Consider de-risking", "",
    ].join("\n");
    const s = parseInsightSections(md);
    expect(s.snapshot).toContain("pre-retiree");
    expect(s.goals).toContain("Retire at 65");
    expect(s.opportunities).toContain("de-risking");
  });
  it("degrades to putting everything in snapshot when headers are missing", () => {
    const s = parseInsightSections("Just some prose without headers.");
    expect(s.snapshot).toContain("Just some prose");
    expect(s.goals).toBe("");
  });
});
