import { describe, it, expect } from "vitest";
import { narrateWhatHappensNext } from "../what-happens-next";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { moneyFact } from "../../facts";
import type { StoryContext, StoryStep } from "../../types";

/** The plan-level facts every chapter's pack carries. This chapter has none of
 *  its own — a step is a sentence, not a figure — so these are what Gate 1 and
 *  Gate 5 have to work with. */
const PLAN_FACTS = [moneyFact("today.netWorth", "Net worth today", 2_100_000)];

function ctxWith(nextSteps: StoryStep[] | undefined): StoryContext {
  return {
    household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
    scenarioLabel: "Retire at 62",
    documentRole: "standalone",
    hasProposal: false,
    strategies: [],
    goals: [],
    facts: PLAN_FACTS,
    nextSteps,
  };
}

const WITH_OWNERS: StoryStep[] = [
  { text: "Send us last year's tax return", owner: "Client", when: "March 1, 2026" },
  { text: "Open the joint brokerage account", owner: "Advisor", when: "" },
  { text: "Check who's named on the retirement account", owner: "", when: "" },
];

/** The same three steps with nothing but their own text — the advisor wrote the
 *  list and left the owner and date columns alone. */
const BARE: StoryStep[] = WITH_OWNERS.map((s) => ({ ...s, owner: "", when: "" }));

const CTX = ctxWith(WITH_OWNERS);
const textOf = (ctx: StoryContext) => narrateWhatHappensNext(ctx).join(" ");

/** Every shape the loader can hand this chapter, plus the one the registry's own
 *  suite hands it: a context built before Task 18 existed, with no `nextSteps`
 *  key at all. */
const PACKS: Array<[string, StoryContext]> = [
  ["steps with owners and dates", CTX],
  ["steps with neither", ctxWith(BARE)],
  ["one step", ctxWith([WITH_OWNERS[0]])],
  ["more steps than the sheet can hold", ctxWith(Array.from({ length: 11 }, () => WITH_OWNERS[0]))],
  ["no next steps agreed yet", ctxWith([])],
  ["a context that predates the field", ctxWith(undefined)],
];

describe("narrateWhatHappensNext", () => {
  it("writes a lead paragraph and leaves the steps themselves to the layout", () => {
    const out = narrateWhatHappensNext(CTX);
    expect(out).toHaveLength(1);
    // The steps are the advisor's own words and print verbatim beneath this
    // paragraph. Restating one would print it twice.
    for (const step of WITH_OWNERS) expect(out[0]).not.toContain(step.text);
  });

  it("counts the steps in words rather than digits", () => {
    expect(textOf(CTX)).toMatch(/\bthree things\b/u);
    expect(textOf(ctxWith([WITH_OWNERS[0]]))).toMatch(/\bone thing\b/u);
  });

  it("says who is doing each one only when a step actually names somebody", () => {
    // "$0 is an honest figure in a dishonest sentence" — the caption under each
    // step is printed only when the advisor filled the owner or date in, so
    // promising it on a list that carries neither describes a page that isn't there.
    expect(textOf(CTX)).toMatch(/looking after/iu);
    expect(textOf(ctxWith(BARE))).not.toMatch(/looking after/iu);
  });

  it("still names the caption when only a date was filled in", () => {
    const dated = [{ text: "Send us last year's tax return", owner: "", when: "March 1, 2026" }];
    expect(textOf(ctxWith(dated))).toMatch(/looking after/iu);
  });

  it("says something true when the advisor has written no next steps", () => {
    const out = narrateWhatHappensNext(ctxWith([]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/we'll agree/iu);
    // …and never counts to nothing: "no things to pick up" is a sentence about
    // an empty list, which is the one thing an empty list should not get.
    expect(out[0]).not.toMatch(/\bthings\b/u);
  });

  it("treats a context with no steps key as a household with no steps", () => {
    expect(textOf(ctxWith(undefined))).toBe(textOf(ctxWith([])));
  });

  it.each(PACKS)("prints no figure that is not in the pack, on %s", (_label, ctx) => {
    // The count is the figure to watch: eleven steps write "11 things", and a
    // bare two-digit integer is deliberately NOT a figure to Gate 1 (ages and
    // counts are not plan outputs). Asserted rather than assumed.
    const shown = new Set(ctx.facts.map((f) => f.display));
    for (const role of ["standalone", "frontMatter"] as const) {
      for (const figure of extractFigures(textOf({ ...ctx, documentRole: role }))) {
        expect(shown.has(figure)).toBe(true);
      }
    }
  });

  it.each(PACKS)("fits the checklist prose budget on %s", (_label, ctx) => {
    // 35 words — `BUDGET_WORDS_CHECKLIST`. The steps ARE the chapter; this is a
    // sentence of lead-in, and anything past the budget prints the trim note on
    // a page whose real content is the list.
    for (const role of ["standalone", "frontMatter"] as const) {
      const words = textOf({ ...ctx, documentRole: role }).split(/\s+/u).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(35);
    }
  });

  it.each(PACKS)("clears every gate on %s, in both registers", (_label, ctx) => {
    for (const role of ["standalone", "frontMatter"] as const) {
      const pack = { ...ctx, documentRole: role };
      expect(
        runGates(narrateWhatHappensNext(pack).join("\n\n"), pack.facts, {
          firstNames: ["Alan", "Teresa"],
          // The checklist is an ENUMERATING layout, exactly as the strategy
          // cards are — `chapterEnumerates` says so and the prompt tells the
          // model the same two rules. Judging it under the other set here would
          // pin a rule the shipping path never applies.
          enumerates: true,
        }),
      ).toEqual([]);
    }
  });
});
