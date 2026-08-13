import { describe, it, expect } from "vitest";
import { narrateHealthCareCosts } from "../health-care-costs";
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

const MEDICARE = ["healthCareCosts"] as const;

const lifetime = (n: number) =>
  moneyFact("medicare.lifetime", "What Medicare costs, current plan", n, MEDICARE);
const surcharge = (n: number) =>
  moneyFact("medicare.irmaa", "The higher-earner surcharge in that", n, MEDICARE);

const CTX = ctxWith([lifetime(420_000), surcharge(60_000)]);
const textOf = (ctx: StoryContext) => narrateHealthCareCosts(ctx).join(" ");

/** Every shape the loader can hand this chapter. The surcharge fact is only
 *  pushed when the household actually pays one, so "no surcharge" is an absent
 *  fact rather than a zero. */
const PACKS: Array<[string, StoryContext]> = [
  ["premiums and a surcharge", CTX],
  ["premiums with no surcharge to name", ctxWith([lifetime(420_000)])],
  ["nobody enrolled inside the horizon", ctxWith([])],
];

describe("narrateHealthCareCosts", () => {
  it("states the lifetime premium total", () => {
    expect(textOf(CTX)).toContain("$420K");
  });

  it("names the surcharge as a share of that total, not a bill beside it", () => {
    const text = textOf(CTX);
    expect(text).toContain("$60K");
    // "of that" / "of the" — the two figures must not read as amounts a client
    // would add together.
    expect(text).toMatch(/\$60K of (?:that|the)/u);
  });

  /**
   * The spec names IRMAA-style jargon as exactly what this report must not
   * assume. Asserted as an absence rather than as "glossed if used": a
   * conditional gloss check passes vacuously on a chapter that never says the
   * word, which is every chapter that has ever passed it.
   */
  it("never writes the acronym, glossed or otherwise", () => {
    for (const [, pack] of PACKS) {
      for (const role of ["standalone", "frontMatter"] as const) {
        expect(textOf({ ...pack, documentRole: role })).not.toMatch(/IRMAA/u);
      }
    }
  });

  it("says nothing about Medicare costs when nobody reaches 65 inside the horizon", () => {
    const text = textOf(ctxWith([]));
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/don't|not something|before you reach/iu);
  });

  it("leaves the surcharge unmentioned when there is none to name", () => {
    const text = textOf(ctxWith([lifetime(420_000)]));
    expect(text).toContain("$420K");
    expect(text).not.toMatch(/surcharge|higher earners/iu);
  });

  it("points forward in frontMatter mode and closes the thought in standalone", () => {
    const front = textOf({ ...CTX, documentRole: "frontMatter" });
    expect(front).not.toBe(textOf(CTX));
    expect(front).toMatch(/pages that follow/iu);
  });

  it("says something true when the pack is empty", () => {
    const out = narrateHealthCareCosts(ctxWith([]));
    expect(out).not.toEqual([]);
    expect(out.join(" ")).not.toMatch(/undefined|null|\[object|\$\s/u);
  });

  it.each(PACKS)("prints no figure that is not in the pack, on %s", (_label, ctx) => {
    // "65" is deliberately safe: Gate 1 does not read a bare two-digit integer
    // as a figure, because ages and counts are not plan outputs.
    const shown = new Set(ctx.facts.map((f) => f.display));
    for (const role of ["standalone", "frontMatter"] as const) {
      for (const figure of extractFigures(textOf({ ...ctx, documentRole: role }))) {
        expect(shown.has(figure)).toBe(true);
      }
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
        runGates(narrateHealthCareCosts(ctx).join("\n\n"), ctx.facts, {
          firstNames: ["Cooper", "Susan"],
        }),
      ).toEqual([]);
    }
  });
});
