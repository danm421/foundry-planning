import { describe, it, expect } from "vitest";
import { narrateProtectingYourFamily } from "../protecting-your-family";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { moneyFact, type Fact } from "../../facts";
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

const COVER = ["protectingYourFamily"] as const;

/** The pack the loader builds, with the life it is about named in the LABEL —
 *  Gate 6 rejects a first name written as anything but direct address, so the
 *  card caption is where it belongs and the prose says "that life". */
const have = (n: number) => moneyFact("cover.have", "Cover in force on Cooper's life", n, COVER);
const need = (n: number) => moneyFact("cover.need", "What the plan points to on Cooper's life", n, COVER);
const gap = (n: number) => moneyFact("cover.gap", "What's missing on Cooper's life", n, COVER);

const SHORT = ctxWith([have(500_000), need(2_500_000), gap(2_000_000)]);
const textOf = (ctx: StoryContext) => narrateProtectingYourFamily(ctx).join(" ");

/** Every shape the loader can hand this chapter. Gate 4's rhythm rule is a
 *  property of a BRANCH, not of a fixture, so the gate, budget and grounding
 *  cases all run over this list × both registers. */
const PACKS: Array<[string, StoryContext]> = [
  ["a shortfall", SHORT],
  ["cover that is enough", ctxWith([have(2_500_000), need(2_500_000)])],
  ["no cover in force at all", ctxWith([have(0), need(1_800_000), gap(1_800_000)])],
  ["a solve that answered for nothing but what is in force", ctxWith([have(500_000)])],
  ["nothing at all", ctxWith([])],
];

describe("narrateProtectingYourFamily", () => {
  it("states the gap plainly when there is one", () => {
    const text = textOf(SHORT);
    expect(text).toContain("$2.0M");
    expect(text).toMatch(/short|gap|less than/iu);
  });

  it("names what is in force and what the plan points to", () => {
    const text = textOf(SHORT);
    expect(text).toContain("$500K");
    expect(text).toContain("$2.5M");
  });

  it("says the cover is enough when it is, without hedging", () => {
    // No `cover.gap` fact is what "enough" looks like out of the loader: the
    // shortfall is only pushed when there is one, so a $0 card never prints.
    const text = textOf(ctxWith([have(2_500_000), need(2_500_000)]));
    expect(text).toMatch(/enough|covered|more than/iu);
    expect(text).not.toMatch(/\bmay\b|\bmight\b|\bcould\b/iu);
    expect(text).not.toMatch(/short/iu);
  });

  /**
   * Nothing in force is a STATEMENT, not a figure.
   *
   * "$0" is a perfectly honest number and the sentence the general branch wraps
   * it in is not: "the policies in force on that life would pay about $0"
   * describes policies this household does not have. The grounding and gate
   * property tests below both pass on that sentence — `$0` is in the pack — so
   * only a recipe test can see it.
   */
  it("says there is nothing in force rather than printing a $0 policy", () => {
    const text = textOf(ctxWith([have(0), need(1_800_000), gap(1_800_000)]));
    expect(text).toMatch(/no cover in force/iu);
    expect(text).not.toContain("$0");
    // …and the shortfall is still named, because there is one.
    expect(text).toContain("$1.8M");
  });

  it("prints an honest empty state when no policies are recorded", () => {
    const text = textOf(ctxWith([]));
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/don't have|nothing recorded|haven't told us/iu);
  });

  /**
   * Gate 3 forbids individualised recommendations, and naming a product on a
   * client page is the shape that gets closest to one. "term" is checked as a
   * substring on purpose — it is the word a chapter about insurance reaches for
   * first, and the gate cannot see it.
   */
  it("never names a policy, a carrier or a product", () => {
    for (const [, pack] of PACKS) {
      for (const role of ["standalone", "frontMatter"] as const) {
        expect(textOf({ ...pack, documentRole: role })).not.toMatch(
          /term|whole life|universal|carrier/iu,
        );
      }
    }
  });

  it("states what is in force without inventing a comparison it has no figure for", () => {
    const text = textOf(ctxWith([have(500_000)]));
    expect(text).toContain("$500K");
    expect(text).not.toMatch(/short|enough/iu);
  });

  it("points forward in frontMatter mode and closes the thought in standalone", () => {
    const front = textOf({ ...SHORT, documentRole: "frontMatter" });
    expect(front).not.toBe(textOf(SHORT));
    expect(front).toMatch(/pages that follow/iu);
  });

  it("says something true when the pack is empty", () => {
    const out = narrateProtectingYourFamily(ctxWith([]));
    expect(out).not.toEqual([]);
    expect(out.join(" ")).not.toMatch(/undefined|null|\[object|\$\s/u);
  });

  it.each(PACKS)("prints no figure that is not in the pack, on %s", (_label, ctx) => {
    const shown = new Set(ctx.facts.map((f) => f.display));
    for (const role of ["standalone", "frontMatter"] as const) {
      for (const figure of extractFigures(textOf({ ...ctx, documentRole: role }))) {
        expect(shown.has(figure)).toBe(true);
      }
    }
  });

  it.each(PACKS)("fits the twoUp prose budget on %s", (_label, pack) => {
    // The figure column takes a third of the text measure, so this layout gets
    // 130 words rather than heroProse's 300.
    for (const role of ["standalone", "frontMatter"] as const) {
      const words = textOf({ ...pack, documentRole: role }).split(/\s+/u).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(130);
    }
  });

  it.each(PACKS)("clears every gate on %s, in both registers", (_label, pack) => {
    for (const role of ["standalone", "frontMatter"] as const) {
      const ctx = { ...pack, documentRole: role };
      expect(
        runGates(narrateProtectingYourFamily(ctx).join("\n\n"), ctx.facts, {
          firstNames: ["Cooper", "Susan"],
        }),
      ).toEqual([]);
    }
  });
});
