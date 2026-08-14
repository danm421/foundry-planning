import { describe, it, expect } from "vitest";
import { narrateThingsToKnow } from "../things-to-know";
import { GLOSSARY } from "../../glossary";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { pctFact, yearFact, type Fact } from "../../facts";
import { BUDGET_WORDS_GLOSSARY, MAX_PARAGRAPHS } from "@/lib/presentations/pages/plan-story/view-model";
import type { StoryContext } from "../../types";

function ctxWith(facts: Fact[]): StoryContext {
  return {
    household: { firstNames: "Cooper and Susan", householdName: "the Cooper household" },
    scenarioLabel: "New Plan",
    documentRole: "standalone",
    hasProposal: false,
    strategies: [],
    goals: [],
    facts,
  };
}

const ASSUMPTIONS = ["thingsToKnow"] as const;

const horizon = (year: number) => yearFact("plan.endOfLifeYear", "The last year we plan to", year);
const inflation = (rate: number) =>
  pctFact("plan.inflationRate", "Prices rise each year by", rate, ASSUMPTIONS);

const CTX = ctxWith([horizon(2051), inflation(0.025)]);
const textOf = (ctx: StoryContext) => narrateThingsToKnow(ctx).join("\n");

/** Every shape the loader can hand this chapter. The horizon is absent only on
 *  a projection that produced no years; the rate is a plan SETTING and is
 *  always in the pack, but zero is a real value an advisor sets deliberately. */
const PACKS: Array<[string, StoryContext]> = [
  ["a horizon and a rate", CTX],
  ["a rate of zero", ctxWith([horizon(2051), inflation(0)])],
  ["a horizon with no rate in the pack", ctxWith([horizon(2051)])],
  ["an empty pack", ctxWith([])],
];

describe("narrateThingsToKnow", () => {
  it("states the assumptions in plain words, without a table", () => {
    const text = textOf(CTX);
    expect(text).not.toContain("|");
    expect(text).toMatch(/assum/iu);
  });

  it("names the horizon and the inflation rate from the pack", () => {
    const text = textOf(CTX);
    expect(text).toContain("2051");
    expect(text).toContain("2.5%");
  });

  it("says prices were held flat rather than printing a rate of zero", () => {
    const text = textOf(ctxWith([horizon(2051), inflation(0)]));
    expect(text).not.toContain("0%");
    expect(text).toMatch(/flat|hold(?:ing)? steady/iu);
  });

  it("says the plan is a projection, not a promise", () => {
    expect(textOf(CTX)).toMatch(/not a (?:promise|guarantee)|no one knows/iu);
  });

  /**
   * The glossary is NOT prose, and this is the red that keeps it that way.
   *
   * The page prints it as a structured block under whatever this narrator
   * writes, so a narrator that also wrote it out would print every definition
   * twice on an ungenerated deck — and, on a generated one, put the model's
   * paraphrase of eleven definitions above our own. `view-model.test.ts` owns
   * the other half: that the block is there on both paths.
   */
  it("leaves the glossary to the page and writes none of it", () => {
    const text = textOf(CTX).toLowerCase();
    for (const entry of GLOSSARY) {
      expect(text, entry.term).not.toContain(entry.plain.toLowerCase());
    }
  });

  /**
   * What the export actually receives, not what this function returns.
   *
   * `generate.ts` stores the AI-off narrative as `narrate(ctx).join("\n\n")` and
   * the export splits it back on a blank line, so a paragraph carrying a bare
   * newline inside it is one paragraph here and two there. Asserting the
   * returned array's length alone cannot tell the two apart.
   */
  it("survives being stored and re-split", () => {
    const paragraphs = narrateThingsToKnow(CTX).join("\n\n").split(/\n{2,}/u);
    expect(paragraphs).toHaveLength(3);
    // The IMPORTED ceiling, not a copy of it: `capParagraphs` drops from the
    // end, so a layout tune that lowered this below three would take the closing
    // line — the only invitation the report makes — off the sheet.
    expect(paragraphs.length).toBeLessThanOrEqual(MAX_PARAGRAPHS);
  });

  it("says something true when the pack is empty", () => {
    const out = narrateThingsToKnow(ctxWith([]));
    expect(out).not.toEqual([]);
    expect(out.join(" ")).not.toMatch(/undefined|null|\[object|\$\s/u);
  });

  /** Deliberately the same in both registers, like chapter 12. A `frontMatter`
   *  chapter is told to point at the pages that follow, and the page that sets
   *  these assumptions out in full is Planning Assumptions — which an advisor
   *  may or may not have put in the deck. */
  it("reads the same in both registers", () => {
    expect(textOf({ ...CTX, documentRole: "frontMatter" })).toBe(textOf(CTX));
  });

  it.each(PACKS)("prints no figure that is not in the pack, on %s", (_label, pack) => {
    const shown = new Set(pack.facts.map((f) => f.display));
    for (const role of ["standalone", "frontMatter"] as const) {
      for (const figure of extractFigures(textOf({ ...pack, documentRole: role }))) {
        expect(shown.has(figure), figure).toBe(true);
      }
    }
  });

  /**
   * The ceiling is `BUDGET_WORDS_GLOSSARY`, 90 — this sheet's prose budget, not
   * a full sheet's 300, because the glossary block underneath takes the rest.
   * This asserts a floor of headroom under it instead, because of WHICH
   * paragraph goes when the budget runs out: `capParagraphs` drops from the end,
   * and the end of this chapter is the advisor's own invitation to ask. A test
   * that only checked "under 90" would pass on the last sentence before the one
   * that silently loses that line.
   */
  it.each(PACKS)("leaves the sheet real headroom on %s", (_label, pack) => {
    for (const role of ["standalone", "frontMatter"] as const) {
      const words = textOf({ ...pack, documentRole: role }).split(/\s+/u).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(BUDGET_WORDS_GLOSSARY - 20);
    }
  });

  it.each(PACKS)("clears every gate on %s, in both registers", (_label, pack) => {
    for (const role of ["standalone", "frontMatter"] as const) {
      const ctx = { ...pack, documentRole: role };
      expect(
        runGates(narrateThingsToKnow(ctx).join("\n\n"), ctx.facts, {
          firstNames: ["Cooper", "Susan"],
        }),
      ).toEqual([]);
    }
  });
});
