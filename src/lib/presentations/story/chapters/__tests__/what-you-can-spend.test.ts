import { describe, it, expect } from "vitest";
import { narrateWhatYouCanSpend } from "../what-you-can-spend";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { moneyFact, type Fact } from "../../facts";
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

const base = (n: number) =>
  moneyFact("spend.base", "What you could spend a year, current plan", n, ["whatYouCanSpend"]);
const proposed = (n: number) =>
  moneyFact("spend.proposed", "What you could spend a year, proposed plan", n, ["whatYouCanSpend"]);

const CTX = ctxWith([base(150_000), proposed(185_000)]);
const textOf = (ctx: StoryContext) => narrateWhatYouCanSpend(ctx).join(" ");

describe("narrateWhatYouCanSpend", () => {
  it("states the spendable figure and says it is in today's money", () => {
    const text = textOf(CTX);
    expect(text).toContain("$185K");
    expect(text).toMatch(/today's money/iu);
  });

  it("never prints a spending figure without the today's-money gloss", () => {
    // The single most misread number in the deck: a client reads it against
    // this year's pay cheque AND against a statement twenty years out, and it
    // cannot mean both. Checked on every branch that prints a figure at all.
    for (const pack of [CTX, ctxWith([proposed(185_000)]), ctxWith([base(150_000)])]) {
      for (const role of ["standalone", "frontMatter"] as const) {
        const text = textOf({ ...pack, documentRole: role });
        expect(text).toMatch(/\$/u);
        expect(text).toMatch(/today's money/iu);
      }
    }
  });

  it("compares against the current plan when both figures are known", () => {
    expect(textOf(CTX)).toContain("$150K");
    expect(textOf(CTX)).toMatch(/current plan/iu);
  });

  it("closes on what the figure is for when there is nothing to compare", () => {
    // Kills: printing "the difference is what the changes buy you" beside one
    // figure, where there is no difference for the sentence to refer to.
    const only = textOf(ctxWith([proposed(185_000)]));
    expect(only).toContain("$185K");
    expect(only).not.toMatch(/the difference/iu);
  });

  it("says nothing about spending when the solve is unavailable", () => {
    const text = textOf(ctxWith([]));
    expect(text).not.toMatch(/\$/u);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/undefined|null|\[object/u);
  });

  it("points forward in frontMatter mode and closes the thought in standalone", () => {
    const front = textOf({ ...CTX, documentRole: "frontMatter" });
    expect(front).not.toBe(textOf(CTX));
    expect(front).toMatch(/pages that follow/iu);
  });

  it("prints no figure that is not in the pack", () => {
    const shown = new Set(CTX.facts.map((f) => f.display));
    for (const figure of extractFigures(textOf(CTX))) {
      expect(shown.has(figure)).toBe(true);
    }
  });

  it("fits the twoUp prose budget", () => {
    for (const ctx of [CTX, ctxWith([]), { ...CTX, documentRole: "frontMatter" as const }]) {
      const words = narrateWhatYouCanSpend(ctx).join(" ").split(/\s+/u).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(130);
    }
  });

  it("clears every gate on every branch, in both registers", () => {
    const packs = [CTX, ctxWith([proposed(185_000)]), ctxWith([base(150_000)]), ctxWith([])];
    for (const pack of packs) {
      for (const role of ["standalone", "frontMatter"] as const) {
        const ctx = { ...pack, documentRole: role };
        expect(
          runGates(narrateWhatYouCanSpend(ctx).join("\n\n"), ctx.facts, {
            firstNames: ["Cooper", "Susan"],
          }),
        ).toEqual([]);
      }
    }
  });
});
