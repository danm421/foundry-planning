import { describe, it, expect } from "vitest";
import { narrateWillTheMoneyLast } from "../will-the-money-last";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { pctFact, type Fact } from "../../facts";
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

const SCOPE = ["planInOnePage", "thePathYoureOn", "willTheMoneyLast"] as const;
const base = (n: number) => pctFact("outcome.confidence.base", "Confidence, current plan", n, SCOPE);
const proposed = (n: number) =>
  pctFact("outcome.confidence.proposed", "Confidence, proposed plan", n, SCOPE);

const CTX = ctxWith([base(0.737), proposed(0.963)]);
const textOf = (ctx: StoryContext) => narrateWillTheMoneyLast(ctx).join(" ");

describe("narrateWillTheMoneyLast", () => {
  it("states both confidences and which way it moved", () => {
    const text = textOf(CTX);
    expect(text).toContain("73.7%");
    expect(text).toContain("96.3%");
    expect(text).toMatch(/up from/iu);
  });

  it("says what was actually tested, so the percentage is glossed where it lands", () => {
    expect(textOf(CTX)).toMatch(/tested the plan against thousands of market futures/iu);
  });

  it("says so when the proposal does NOT improve confidence", () => {
    // Both households in the 2026-08-12 audit had a no-change case; Warner's was
    // 100% to 100%. A chapter that always claims improvement is a chapter that
    // lies on an annual review.
    const flat = ctxWith([base(1), proposed(1)]);
    expect(textOf(flat)).toMatch(/the same as/iu);
    expect(textOf(flat)).not.toMatch(/up from|down from/iu);
  });

  it("says so plainly when the proposal makes it worse", () => {
    // A rule that only knew "same" and "better" would pass the two above and
    // still print "up from" over a proposal that lowered the number.
    expect(textOf(ctxWith([base(0.91), proposed(0.73)]))).toMatch(/down from/iu);
  });

  it("calls two figures that round alike the same, not a rise", () => {
    const nearly = ctxWith([base(0.9061), proposed(0.9064)]);
    // Both display "90.6%". Calling that a rise puts two identical figures on
    // the page either side of the word "up".
    const text = textOf(nearly);
    expect(text).not.toMatch(/up from|down from/iu);
    expect(text).toMatch(/the same as/iu);
  });

  it("states one confidence alone without inventing a comparison", () => {
    expect(textOf(ctxWith([proposed(0.963)]))).toContain("96.3%");
    expect(textOf(ctxWith([proposed(0.963)]))).not.toMatch(/current path/iu);
    expect(textOf(ctxWith([base(0.737)]))).toContain("73.7%");
  });

  it("points forward in frontMatter mode and closes the thought in standalone", () => {
    const front = textOf({ ...CTX, documentRole: "frontMatter" });
    expect(front).not.toBe(textOf(CTX));
    expect(front).toMatch(/pages that follow/iu);
  });

  it("says something true when the pack is empty", () => {
    const out = narrateWillTheMoneyLast(ctxWith([]));
    expect(out).not.toEqual([]);
    expect(out.join(" ")).not.toMatch(/undefined|null|\[object|%/u);
  });

  it("prints no figure that is not in the pack", () => {
    const shown = new Set(CTX.facts.map((f) => f.display));
    for (const figure of extractFigures(textOf(CTX))) {
      expect(shown.has(figure)).toBe(true);
    }
  });

  it("fits the twoUp prose budget", () => {
    // The figure column takes a third of the text measure, so this layout gets
    // 130 words rather than heroProse's 300. A narrator over the budget is
    // trimmed mid-chapter with an italic aside the advisor never asked for.
    for (const ctx of [CTX, ctxWith([]), { ...CTX, documentRole: "frontMatter" as const }]) {
      const words = narrateWillTheMoneyLast(ctx).join(" ").split(/\s+/u).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(130);
    }
  });

  it("clears every gate on every branch, in both registers", () => {
    // Every branch, both roles. Gate 4's rhythm rule is what this catches: the
    // chapter is three sentences long, so one branch landing on an even cadence
    // is a real and easy failure — it happened at 0.113 against a floor of
    // 0.122 on the one-confidence branch with the forward pointer.
    const packs = [
      CTX,
      ctxWith([base(1), proposed(1)]),
      ctxWith([base(0.9061), proposed(0.9064)]),
      ctxWith([proposed(0.963)]),
      ctxWith([base(0.737)]),
      ctxWith([]),
    ];
    for (const pack of packs) {
      for (const role of ["standalone", "frontMatter"] as const) {
        const ctx = { ...pack, documentRole: role };
        expect(
          runGates(narrateWillTheMoneyLast(ctx).join("\n\n"), ctx.facts, {
            firstNames: ["Cooper", "Susan"],
          }),
        ).toEqual([]);
      }
    }
  });
});
