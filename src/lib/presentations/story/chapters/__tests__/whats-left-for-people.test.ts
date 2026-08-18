import { describe, it, expect } from "vitest";
import { narrateWhatsLeftForPeople } from "../whats-left-for-people";
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

const ESTATE = ["whatsLeftForPeople"] as const;
const PLAN = { base: "current", proposed: "proposed" } as const;
type Side = keyof typeof PLAN;

const net = (side: Side, n: number) =>
  moneyFact(`estate.net.${side}`, `What reaches your heirs, ${PLAN[side]} plan`, n, ESTATE);
const cost = (side: Side, n: number) =>
  moneyFact(`estate.cost.${side}`, `Tax and costs on the estate, ${PLAN[side]} plan`, n, ESTATE);
const grossToday = (n: number) =>
  moneyFact("chart.estate.grossToday", "The whole estate as it stands today, before anything comes out", n, ESTATE);
const grossEndOfLife = (n: number) =>
  moneyFact(
    "chart.estate.grossEndOfLife",
    "The whole estate at the end of the plan, before anything comes out",
    n,
    ESTATE,
  );

const CTX = ctxWith([net("base", 3_100_000), net("proposed", 3_900_000), cost("base", 700_000), cost("proposed", 400_000)]);
const textOf = (ctx: StoryContext) => narrateWhatsLeftForPeople(ctx).join(" ");

/**
 * A base-only deck's estate pack: the current plan's own net/cost, plus the
 * chart's today/end-of-plan pair — the two facts `build-facts.ts` emits only
 * when the estate chart drew `todayVsEndOfLife` rather than `planVsPlan`. No
 * `estate.net.proposed`, so `movement` reads null and the sentence under test
 * is the one that runs instead.
 */
function baseCtx({ today, endOfLife }: { today: number; endOfLife: number }): StoryContext {
  return ctxWith([net("base", 5_000_000), cost("base", 700_000), grossToday(today), grossEndOfLife(endOfLife)]);
}

/**
 * The proposal deck this chapter already ships — `CTX` itself, reused rather
 * than rebuilt. It carries `estate.net.proposed`, so `movement` is non-null
 * and the base-only sentence below must never run alongside it.
 */
const PROPOSAL_CTX = CTX;

/**
 * The shipped text of `narrateWhatsLeftForPeople(PROPOSAL_CTX)`, captured by
 * running the chapter at 1344a1ebd — the commit before this file's estate-
 * over-time sentence existed — and reading its own return value back, not by
 * retyping it from the template by hand. Hard-coded so a change to the
 * base-only branch can never quietly also change what a proposal deck prints.
 */
const SHIPPED_PARAGRAPHS = [
  "What's left at the end goes to the people and causes you've named.",
  "On your current plan that's about $3.1M.",
  "The changes we're proposing lift that to about $3.9M.",
  "Tax and the cost of settling the estate take about $700K before it gets there.",
  "It's what the plan is protecting for them.",
];

/** Every shape the loader can hand this chapter. The gate, budget and grounding
 *  cases all run over this list rather than over `CTX` alone — Gate 4's rhythm
 *  rule is a property of a BRANCH, and a single-fixture check cannot see it. */
const PACKS: Array<[string, StoryContext]> = [
  ["both plans, with their costs", CTX],
  ["both plans, no cost figures", ctxWith([net("base", 3_100_000), net("proposed", 3_900_000)])],
  ["a proposal that changes nothing", ctxWith([net("base", 9_200_000), net("proposed", 9_200_000), cost("base", 700_000), cost("proposed", 700_000)])],
  ["a proposal that leaves less", ctxWith([net("base", 3_900_000), net("proposed", 3_100_000), cost("base", 400_000)])],
  ["the current plan alone", ctxWith([net("base", 3_100_000), cost("base", 700_000)])],
  ["the proposal alone", ctxWith([net("proposed", 3_900_000), cost("proposed", 400_000)])],
  ["nothing at all", ctxWith([])],
  // A base-only deck with the estate chart: the fifth sentence this task adds,
  // on top of the four the other PACKS entries already exercise — the shape
  // the word-budget and gate checks below have to see to mean anything for it.
  ["a base-only deck with the estate chart", baseCtx({ today: 4_100_000, endOfLife: 3_000_000 })],
];

describe("narrateWhatsLeftForPeople", () => {
  it("names the difference the changes make to what reaches the heirs", () => {
    const text = textOf(CTX);
    expect(text).toContain("$3.1M");
    expect(text).toContain("$3.9M");
  });

  it("names what tax and settling cost on the way, when the pack holds it", () => {
    expect(textOf(CTX)).toContain("$700K");
  });

  it("never says 'estate shrinkage' or any other term of art un-glossed", () => {
    const text = textOf(CTX);
    expect(text).not.toMatch(/\bshrinkage\b|\billiquid\b|\bstepped-up basis\b/iu);
  });

  it("prints an honest empty state, not a blank, when there is no estate to speak of", () => {
    const text = textOf(ctxWith([]));
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/don't have|nothing recorded|haven't/iu);
  });

  it("does not claim an improvement when the two sides are the same", () => {
    const flat = ctxWith([net("base", 9_200_000), net("proposed", 9_200_000)]);
    expect(textOf(flat)).toMatch(/same|unchanged|no different/iu);
  });

  /**
   * The direction has to be readable off the page, not just off `raw`. Two
   * values that round to one display are the same figure to the client, and
   * "lifts that to $9.2M" printed beside $9.2M is a claim the page refutes.
   */
  it("calls two figures that round alike unchanged, not a rise", () => {
    const nearly = ctxWith([net("base", 9_160_000), net("proposed", 9_240_000)]);
    expect(nearly.facts[0].display).toBe(nearly.facts[1].display);
    expect(textOf(nearly)).toMatch(/unchanged/iu);
    expect(textOf(nearly)).not.toMatch(/\blifts?\b|\blowers?\b/iu);
  });

  // A proposal can leave the heirs LESS — spending more, giving more away in
  // life. A chapter that only knows how to say "more" lies on exactly the
  // households an advisor most needs to be straight with.
  it("says so plainly when the changes leave less behind", () => {
    const worse = ctxWith([net("base", 3_900_000), net("proposed", 3_100_000)]);
    const text = textOf(worse);
    expect(text).toMatch(/lower/iu);
    expect(text).not.toMatch(/\blifts?\b/iu);
  });

  it("states one side alone without inventing a comparison", () => {
    const baseOnly = textOf(ctxWith([net("base", 3_100_000)]));
    expect(baseOnly).toContain("$3.1M");
    expect(baseOnly).not.toMatch(/changes we're proposing/iu);

    const proposedOnly = textOf(ctxWith([net("proposed", 3_900_000)]));
    expect(proposedOnly).toContain("$3.9M");
    expect(proposedOnly).not.toMatch(/current plan/iu);
  });

  it("points forward in frontMatter mode and closes the thought in standalone", () => {
    const front = textOf({ ...CTX, documentRole: "frontMatter" });
    expect(front).not.toBe(textOf(CTX));
    expect(front).toMatch(/pages that follow/iu);
  });

  it("says something true when the pack is empty", () => {
    const out = narrateWhatsLeftForPeople(ctxWith([]));
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
    // The figure column takes a third of the text measure, so this layout gets
    // 130 words rather than heroProse's 300. A narrator over the budget is
    // trimmed mid-chapter with an italic aside the advisor never asked for.
    for (const role of ["standalone", "frontMatter"] as const) {
      const words = textOf({ ...pack, documentRole: role }).split(/\s+/u).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(130);
    }
  });

  it.each(PACKS)("clears every gate on %s, in both registers", (_label, pack) => {
    // Every branch, both roles. Gate 4's rhythm rule is what this catches: a
    // twoUp chapter is four or five sentences, so one branch landing on an even
    // cadence is a real and easy failure — chapter 6's did, at 0.113 against a
    // floor of 0.122.
    for (const role of ["standalone", "frontMatter"] as const) {
      const ctx = { ...pack, documentRole: role };
      expect(
        runGates(narrateWhatsLeftForPeople(ctx).join("\n\n"), ctx.facts, {
          firstNames: ["Cooper", "Susan"],
        }),
      ).toEqual([]);
    }
  });

  it("names both bars on a base-only deck, and says which way the estate moved", () => {
    const shrinking = textOf(baseCtx({ today: 4_100_000, endOfLife: 3_000_000 }));
    expect(shrinking).toContain("$4.1M");
    expect(shrinking).toContain("$3.0M");
    expect(shrinking).toMatch(/smaller|less/i);

    // ⚠️ NOT always smaller. An estate can grow across the plan, and a chapter
    // that only knew how to say "shrinks" would tell those households the
    // opposite of what their own picture shows.
    const growing = textOf(baseCtx({ today: 3_000_000, endOfLife: 4_100_000 }));
    expect(growing).toMatch(/larger|more|grows/i);
    expect(growing).not.toMatch(/smaller/i);
  });

  it("says neither when the two figures round to the same display", () => {
    // 4_010_000 and 4_040_000 both print "$4.0M" — comfortably inside one
    // rounding bucket, unlike a pair straddling an x.x5 boundary (4_050_000
    // rounds to "$4.0M" and 4_060_000 to "$4.1M" under plain `toFixed(1)`
    // float behaviour, so a pair chosen either side of .05 is not a safe
    // "equal display" fixture).
    const flat = textOf(baseCtx({ today: 4_010_000, endOfLife: 4_040_000 }));
    expect(flat).not.toMatch(/smaller|larger/i);
  });

  it("says nothing about how the estate moves when only one gross figure is on the pack", () => {
    // The chart draws both bars or neither — see `build-facts.ts`'s note on
    // `ESTATE_FIGURE_NAMES` — but the chapter still has to survive a pack that
    // only carries one, without inventing the other half of a comparison.
    const onlyToday = textOf(ctxWith([net("base", 5_000_000), cost("base", 700_000), grossToday(4_100_000)]));
    expect(onlyToday).not.toMatch(/end of the plan/i);
  });

  it("leaves a proposal deck's prose unchanged", () => {
    // The shipped text, character for character. This chapter ships today.
    expect(narrateWhatsLeftForPeople(PROPOSAL_CTX)).toEqual(SHIPPED_PARAGRAPHS);
  });
});
