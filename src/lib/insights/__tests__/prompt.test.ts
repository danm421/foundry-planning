import { describe, it, expect } from "vitest";
import { buildInsightsPrompt, parseInsightSections } from "../prompt";
import type { InsightsBattery } from "../battery";

const battery: InsightsBattery = {
  clientName: "Cooper Household",
  kpis: { netWorth: 2_000_000, liquidPortfolio: 1_200_000, yearsToRetirement: 5, mcSuccessRate: 0.9, fundingScore: 1.2 },
  retirementPeople: [
    { label: "Cooper", currentAge: 60, retirementAge: 65, retirementYear: 2031 },
  ],
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

  // Regression: the Cooper & Susan Sample 360 profile read "Retire in 14 years,
  // around Cooper's 60th birthday" — it welded the plan's 14-year horizon onto a
  // Feb-2026 discovery note ("both want to retire around Cooper's 60th
  // birthday") even though the plan models retirement at 65 in 2040. The prompt
  // only carried "years to retirement", so the model had no plan-side age or
  // year to contradict the note with.
  it("states each person's plan retirement age and calendar year", () => {
    const { user } = buildInsightsPrompt({
      ...battery,
      kpis: { ...battery.kpis, yearsToRetirement: 14 },
      retirementPeople: [
        { label: "Cooper", currentAge: 51, retirementAge: 65, retirementYear: 2040 },
        { label: "Susan", currentAge: 47, retirementAge: 65, retirementYear: 2043 },
      ],
    });
    expect(user).toContain("Cooper (now 51) retires at age 65 in 2040");
    expect(user).toContain("Susan (now 47) retires at age 65 in 2043");
  });

  it("tells the model the plan outranks advisor notes on conflicting figures", () => {
    const { system } = buildInsightsPrompt(battery);
    expect(system).toMatch(/authoritative/i);
    expect(system).toMatch(/notes/i);
    expect(system).toMatch(/conflict/i);
  });

  it("degrades gracefully when no retirement age is on file", () => {
    const { user } = buildInsightsPrompt({ ...battery, retirementPeople: [] });
    expect(user).toContain("no retirement age on file");
  });

  it("omits the calendar year when the DOB is unknown", () => {
    const { user } = buildInsightsPrompt({
      ...battery,
      retirementPeople: [
        { label: "Dana", currentAge: null, retirementAge: 67, retirementYear: null },
      ],
    });
    expect(user).toContain("Dana (current age unknown) retires at age 67");
    expect(user).not.toContain("retires at age 67 in");
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
