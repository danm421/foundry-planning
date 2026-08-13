import { describe, it, expect } from "vitest";
import { narrateThePathYoureOn } from "../the-path-youre-on";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { moneyFact, pctFact, yearFact, type Fact } from "../../facts";
import type { StoryContext } from "../../types";

function ctxWith(facts: Fact[]): StoryContext {
  return {
    household: { firstNames: "Cooper and Susan", householdName: "the Cooper household" },
    scenarioLabel: "New Plan",
    documentRole: "standalone",
    hasProposal: true,
    strategies: [],
    goals: [],
    facts,
  };
}

const OUTCOME = ["planInOnePage", "thePathYoureOn"] as const;
const END_OF_PLAN = yearFact("plan.endOfLifeYear", "The last year we plan to", 2070);

const HOLDS = ctxWith([
  pctFact("outcome.confidence.base", "Confidence, current plan", 0.91, OUTCOME),
  moneyFact("outcome.legacy.base", "Left at the end, current plan", 4_500_000, OUTCOME),
  END_OF_PLAN,
]);

const RUNS_SHORT = ctxWith([
  pctFact("outcome.confidence.base", "Confidence, current plan", 0.42, OUTCOME),
  yearFact("base.shortfallYear", "The year the current plan runs short", 2049, ["thePathYoureOn"]),
  END_OF_PLAN,
]);

const textOf = (ctx: StoryContext) => narrateThePathYoureOn(ctx).join(" ");

describe("narrateThePathYoureOn", () => {
  it("glosses confidence in the same sentence it uses it", () => {
    const text = textOf(HOLDS);
    expect(text).toContain("91%");
    // Gate 2 bans un-glossed jargon; "confidence" is the report's central term
    // and the spec names it as one a lay reader cannot be assumed to know.
    expect(text).toMatch(/out of|tested|tried|runs/iu);
  });

  it("says plainly when the plan runs short, and when", () => {
    const text = textOf(RUNS_SHORT);
    expect(text).toContain("2049");
    expect(text).toMatch(/runs short|runs out|falls short|running short/iu);
  });

  it("leads with the shortfall rather than with what is left over", () => {
    // Kills: printing the legacy figure ahead of the bad news, or instead of it.
    // A shortfall year is the most important thing on this sheet, and a report
    // that opens the paragraph with "$4.5M still there" sounds reassuring about
    // a plan that does not hold.
    const both = ctxWith([...RUNS_SHORT.facts, moneyFact("outcome.legacy.base", "Left at the end, current plan", 4_500_000, OUTCOME)]);
    const text = textOf(both);
    expect(text).toMatch(/running short/iu);
    expect(text).not.toContain("$4.5M");
  });

  it("does not hedge a plan that holds", () => {
    expect(textOf(HOLDS)).not.toMatch(/may|might|could/iu);
  });

  it("points forward in frontMatter mode and closes the thought in standalone", () => {
    // Plan 1's final review found `documentRole` never reached the model: the
    // Executive brief's defining behaviour was inert end to end across four
    // tasks. Every narrator that varies by role gets this assertion.
    const front = textOf({ ...RUNS_SHORT, documentRole: "frontMatter" });
    const alone = textOf({ ...RUNS_SHORT, documentRole: "standalone" });
    expect(front).not.toBe(alone);
    expect(front).toMatch(/pages that follow/iu);
    expect(alone).not.toMatch(/pages that follow/iu);
  });

  it("states the horizon-less good case without inventing an end year", () => {
    const noEnd = ctxWith([moneyFact("outcome.legacy.base", "Left at the end, current plan", 4_500_000, OUTCOME)]);
    const text = textOf(noEnd);
    expect(text).toContain("$4.5M");
    expect(text).not.toMatch(/\b(?:19|20)\d{2}\b/u);
  });

  it("says something true when the pack is empty", () => {
    const out = narrateThePathYoureOn(ctxWith([]));
    expect(out).not.toEqual([]);
    expect(out.join(" ")).not.toMatch(/undefined|null|\[object/u);
  });

  it("prints no figure that is not in the pack", () => {
    for (const ctx of [HOLDS, RUNS_SHORT]) {
      const shown = new Set(ctx.facts.map((f) => f.display));
      for (const figure of extractFigures(textOf(ctx))) {
        expect(shown.has(figure)).toBe(true);
      }
    }
  });

  it("clears every gate on its own output, in both registers and both outcomes", () => {
    for (const base of [HOLDS, RUNS_SHORT, ctxWith([])]) {
      for (const role of ["standalone", "frontMatter"] as const) {
        const ctx = { ...base, documentRole: role };
        expect(
          runGates(narrateThePathYoureOn(ctx).join("\n\n"), ctx.facts, {
            firstNames: ["Cooper", "Susan"],
          }),
        ).toEqual([]);
      }
    }
  });
});
