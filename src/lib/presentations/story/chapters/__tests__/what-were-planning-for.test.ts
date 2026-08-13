import { describe, it, expect } from "vitest";
import { narrateWhatWerePlanningFor } from "../what-were-planning-for";
import { runGates } from "../../validate";
import { extractFigures } from "../../validate/facts";
import { yearFact } from "../../facts";
import { goalYearFactId } from "../../build-facts";
import type { StoryContext } from "../../types";

const CTX: StoryContext = {
  household: { firstNames: "Cooper and Susan", householdName: "the Sample household" },
  scenarioLabel: "New Plan",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [],
  goals: [
    { name: "Maggie's college", year: 2032, kind: "Education" },
    { name: "A place at the lake", year: 2036, kind: "Purchase" },
    { name: "Leave something for the grandchildren", year: null, kind: "Household" },
  ],
  facts: [
    yearFact("plan.retirementYear", "The year you stop working", 2035, ["whatWerePlanningFor"]),
    yearFact("plan.endOfLifeYear", "The last year we plan to", 2070),
    // The goal DATES are figures like any other, so the pack holds them and the
    // narrator reads them back. The plan's own fixture omitted these, which is
    // the defect this file's gate test would have found: a year printed straight
    // off `StoryGoal.year` is a four-digit number Gate 1 has never been shown.
    yearFact(goalYearFactId(0), "Goal date — Maggie's college", 2032, ["whatWerePlanningFor"]),
    yearFact(goalYearFactId(1), "Goal date — A place at the lake", 2036, ["whatWerePlanningFor"]),
  ],
};

function textOf(ctx: StoryContext): string {
  return narrateWhatWerePlanningFor(ctx).join(" ");
}

/** One goal, with its own date in the pack and the fixture's three goals gone.
 *  Spreading a second `goal.0.year` onto `CTX.facts` would NOT override the
 *  first — `findFact` returns the earliest match — so the goal facts are
 *  replaced rather than appended. */
function oneGoal(name: string, year: number | null): StoryContext {
  return {
    ...CTX,
    goals: [{ name, year, kind: "" }],
    facts: [
      ...CTX.facts.filter((f) => !f.id.startsWith("goal.")),
      ...(year == null
        ? []
        : [yearFact(goalYearFactId(0), `Goal date — ${name}`, year, ["whatWerePlanningFor"])]),
    ],
  };
}

describe("narrateWhatWerePlanningFor", () => {
  it("names the goals in the household's own words", () => {
    const text = textOf(CTX);
    expect(text).toContain("Maggie's college");
    expect(text).toContain("A place at the lake");
  });

  it("dates the goals that have a year and leaves the open-ended one undated", () => {
    const text = textOf(CTX);
    expect(text).toContain("2032");
    expect(text).toMatch(/grandchildren/u);
    expect(text).not.toMatch(/grandchildren[^.]*\b(19|20)\d{2}/u);
  });

  it("states the horizon from the pack, not from the goals", () => {
    expect(textOf(CTX)).toContain("The plan runs from now to 2070, with work ending in 2035.");
  });

  it("drops the retirement half when the pack has no retirement year", () => {
    // An already-retired household: `build-facts.ts` omits the fact rather than
    // printing a year that has been and gone.
    const ctx = { ...CTX, facts: CTX.facts.filter((f) => f.id !== "plan.retirementYear") };
    expect(textOf(ctx)).toContain("The plan runs from now to 2070.");
  });

  it("prints a goal undated when its year is not in the pack", () => {
    // Kills: printing `goal.year` straight out of the context. The goal still
    // gets its sentence — an ungrounded YEAR is what has to go, not the goal.
    const ctx = { ...CTX, facts: CTX.facts.filter((f) => !f.id.startsWith("goal.")) };
    const text = textOf(ctx);
    expect(text).toContain("Maggie's college");
    expect(text).not.toContain("2032");
  });

  it("says something true when there are no goals at all", () => {
    const text = textOf({ ...CTX, goals: [] });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/undefined|null|\[object/u);
  });

  it("says something true when the pack is empty too", () => {
    expect(narrateWhatWerePlanningFor({ ...CTX, goals: [], facts: [] })).not.toEqual([]);
  });

  it("drops a goal name carrying a figure we never formatted", () => {
    // Household-entered text is the one string on this chapter that reaches the
    // client unaltered, so it goes through the same grounding check every other
    // borrowed string does. "$50k" is in no pack here, so the NAME goes.
    const text = textOf(oneGoal("$50k for the boat", null));
    expect(text).not.toContain("$50k");
    expect(text).not.toContain("boat");
  });

  it("keeps a goal name whose figure the pack does hold, in that spelling", () => {
    // The other side of the same rule — a check that dropped everything would
    // pass the test above and be worthless.
    expect(textOf(oneGoal("Set aside 2070 for the boat", null))).toContain(
      "Set aside 2070 for the boat",
    );
  });

  it("drops a goal whose name reads as an instruction to the client", () => {
    // A household types its goals as instructions to itself, and Gate 3 rejects
    // an action verb governing a recognisable object — "sell THE RENTAL" — from
    // anywhere in a sentence. Publishing it would make the narrator fail the
    // gate its own chapter is judged by, which is what makes the gate unusable.
    // The date does not rescue this one; the test below is the shape it does.
    for (const year of [null, 2036]) {
      expect(textOf(oneGoal("Sell the rental", year))).not.toContain("Sell the rental");
    }
  });

  it("keeps a moving-house goal once the date puts the name mid-sentence", () => {
    // The framing is load-bearing, not decoration. "Move to Florida." opening a
    // sentence is a command; "In 2036, Move to Florida." is a date and a plan,
    // and the same gate reads it that way. Dropping it would lose a real goal.
    expect(textOf(oneGoal("Move to Florida", 2036))).toContain("In 2036, Move to Florida.");
    expect(textOf(oneGoal("Move to Florida", null))).not.toContain("Move to Florida");
  });

  it("prints no figure that is not in the pack", () => {
    const shown = new Set(CTX.facts.map((f) => f.display));
    for (const figure of extractFigures(textOf(CTX))) {
      expect(shown.has(figure)).toBe(true);
    }
  });

  it("clears every gate on its own output", () => {
    // The narrator is what prints when the model fails. Prose that the gates
    // would reject is prose the app publishes itself while refusing the model's.
    expect(
      runGates(narrateWhatWerePlanningFor(CTX).join("\n\n"), CTX.facts, {
        firstNames: ["Cooper", "Susan"],
      }),
    ).toEqual([]);
  });

  it("clears every gate on the no-goals fallback too", () => {
    // The branch most likely to ship: a household whose goals were never typed
    // in. It is also the shortest text in the report, so it is the one with the
    // least room to satisfy Gate 4's rhythm rule.
    const ctx = { ...CTX, goals: [] };
    expect(
      runGates(narrateWhatWerePlanningFor(ctx).join("\n\n"), ctx.facts, {
        firstNames: ["Cooper", "Susan"],
      }),
    ).toEqual([]);
  });
});
