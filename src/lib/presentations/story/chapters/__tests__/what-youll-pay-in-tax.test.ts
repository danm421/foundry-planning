import { describe, it, expect } from "vitest";
import { narrateWhatYoullPayInTax } from "../what-youll-pay-in-tax";
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

const TAX = ["whatYoullPayInTax"] as const;
const PLAN = { base: "current", proposed: "proposed" } as const;
type Side = keyof typeof PLAN;

const lifetime = (side: Side, n: number) =>
  moneyFact(`tax.lifetime.${side}`, `Total income tax over the plan, ${PLAN[side]} plan`, n, TAX);

const CTX = ctxWith([lifetime("base", 1_400_000), lifetime("proposed", 1_100_000)]);
const textOf = (ctx: StoryContext) => narrateWhatYoullPayInTax(ctx).join(" ");

/** Every shape the loader can hand this chapter — the gate, budget and
 *  grounding cases all run over the list, not over `CTX` alone. */
const PACKS: Array<[string, StoryContext]> = [
  ["a proposal that saves tax", CTX],
  ["a proposal that raises tax", ctxWith([lifetime("base", 1_100_000), lifetime("proposed", 1_400_000)])],
  ["a proposal that changes nothing", ctxWith([lifetime("base", 1_100_000), lifetime("proposed", 1_100_000)])],
  ["the current plan alone", ctxWith([lifetime("base", 1_400_000)])],
  ["the proposal alone", ctxWith([lifetime("proposed", 1_100_000)])],
  ["nothing at all", ctxWith([])],
];

describe("narrateWhatYoullPayInTax", () => {
  it("states both lifetime totals and which direction the plan moves them", () => {
    const text = textOf(CTX);
    expect(text).toContain("$1.4M");
    expect(text).toContain("$1.1M");
    expect(text).toMatch(/less|lower|saves/iu);
  });

  it("says 'over the whole plan', because a lifetime total is the figure people misread", () => {
    expect(textOf(CTX)).toMatch(/over the (?:whole )?plan|across all the years|between now and/iu);
  });

  /**
   * The important one. A Roth conversion strategy RAISES lifetime income tax on
   * purpose — that is what it buys — and a narrator that only knows how to say
   * "you save" would tell a client the opposite of what the plan does.
   */
  it("does not present a tax RISE as a saving", () => {
    const worse = ctxWith([lifetime("base", 1_100_000), lifetime("proposed", 1_400_000)]);
    const text = textOf(worse);
    expect(text).not.toMatch(/saves|less tax|lower/iu);
    expect(text).toMatch(/more/iu);
  });

  it("does not claim a saving when the two sides are the same", () => {
    const flat = ctxWith([lifetime("base", 1_100_000), lifetime("proposed", 1_100_000)]);
    expect(textOf(flat)).toMatch(/same|unchanged|no different/iu);
  });

  // Two totals that round to one display are one figure to the client, and a
  // direction read off `raw` alone would put "less" between two identical
  // numbers.
  it("calls two totals that round alike the same, not a saving", () => {
    const nearly = ctxWith([lifetime("base", 1_160_000), lifetime("proposed", 1_240_000)]);
    expect(nearly.facts[0].display).toBe(nearly.facts[1].display);
    expect(textOf(nearly)).toMatch(/about the same/iu);
  });

  it("states one total alone without inventing a comparison", () => {
    const baseOnly = textOf(ctxWith([lifetime("base", 1_400_000)]));
    expect(baseOnly).toContain("$1.4M");
    expect(baseOnly).not.toMatch(/changes we're proposing/iu);

    const proposedOnly = textOf(ctxWith([lifetime("proposed", 1_100_000)]));
    expect(proposedOnly).toContain("$1.1M");
    expect(proposedOnly).not.toMatch(/current path/iu);
  });

  it("prints an honest empty state rather than a blank sheet", () => {
    const text = textOf(ctxWith([]));
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/don't have|nothing recorded|haven't/iu);
  });

  it("points forward in frontMatter mode and closes the thought in standalone", () => {
    const front = textOf({ ...CTX, documentRole: "frontMatter" });
    expect(front).not.toBe(textOf(CTX));
    expect(front).toMatch(/pages that follow/iu);
  });

  it("says something true when the pack is empty", () => {
    const out = narrateWhatYoullPayInTax(ctxWith([]));
    expect(out).not.toEqual([]);
    expect(out.join(" ")).not.toMatch(/undefined|null|\[object|\$\s/u);
  });

  it.each(PACKS)("prints no figure that is not in the pack, on %s", (_label, ctx) => {
    const shown = new Set(ctx.facts.map((f) => f.display));
    for (const figure of extractFigures(textOf(ctx))) {
      expect(shown.has(figure)).toBe(true);
    }
  });

  it.each(PACKS)("fits the twoUp prose budget on %s", (_label, pack) => {
    for (const role of ["standalone", "frontMatter"] as const) {
      const words = textOf({ ...pack, documentRole: role }).split(/\s+/u).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(130);
    }
  });

  it.each(PACKS)("clears every gate on %s, in both registers", (_label, pack) => {
    for (const role of ["standalone", "frontMatter"] as const) {
      const ctx = { ...pack, documentRole: role };
      expect(
        runGates(narrateWhatYoullPayInTax(ctx).join("\n\n"), ctx.facts, {
          firstNames: ["Cooper", "Susan"],
        }),
      ).toEqual([]);
    }
  });
});
