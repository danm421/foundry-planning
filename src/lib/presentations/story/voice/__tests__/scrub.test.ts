import { describe, it, expect } from "vitest";
import { scrubSample } from "../scrub";

const HOUSEHOLD = { firstNames: "Cooper and Susan", householdName: "the Sample household" };

describe("scrubSample", () => {
  it("removes the household's first names", () => {
    expect(scrubSample("Cooper, your plan holds up.", HOUSEHOLD)).not.toContain("Cooper");
  });

  // `not.toContain` is blind to WHAT replaced it: "the they household" satisfies
  // it. `load-context.ts` builds every household name as "the <lastName>
  // household", so this phrase is the common case and the output text is the
  // assertion.
  it("removes the household name", () => {
    expect(scrubSample("This is what the Sample household owns.", HOUSEHOLD)).toBe(
      "This is what the household owns.",
    );
  });

  it("removes the surname on its own, and in the plural", () => {
    expect(scrubSample("Sample's plan holds.", HOUSEHOLD)).toBe("The household's plan holds.");
    expect(scrubSample("The Samples are ahead of it.", HOUSEHOLD)).toBe(
      "The household are ahead of it.",
    );
  });

  it("removes every figure, because a figure is about one plan and no other", () => {
    const out = scrubSample("You own $2.9M and owe $480K, which leaves $2.4M.", HOUSEHOLD);
    expect(out).not.toMatch(/\$/u);
    expect(out).not.toMatch(/\d/u);
  });

  it("removes a bare year", () => {
    expect(scrubSample("Work ends in 2035 and we plan through 2070.", HOUSEHOLD)).not.toMatch(/\d/u);
  });

  // …and the must-PASS half. A scrubber that returns "" for everything satisfies
  // every assertion above and destroys the feature.
  it("keeps the sentences that carry the VOICE, which is the whole point", () => {
    const out = scrubSample(
      "Here's the short version: you're in good shape, and the change we're suggesting buys you room.",
      HOUSEHOLD,
    );
    expect(out).toContain("Here's the short version");
    expect(out).toContain("buys you room");
  });

  it("leaves ordinary prose with no names or figures completely alone", () => {
    const text = "We'll walk through the rest together when we meet.";
    expect(scrubSample(text, HOUSEHOLD)).toBe(text);
  });

  // A name is a WORD. "Alan" is a substring of "balance", and a scrubber that
  // eats that is a scrubber that mangles ordinary prose.
  it("does not eat a name that is only a substring", () => {
    expect(scrubSample("Your balance holds.", { firstNames: "Alan", householdName: "x" })).toContain("balance");
  });

  // The three cases below are what reading the scrubber's actual output found.
  // Every one of them satisfies the assertions above and every one of them
  // teaches the model damage, which is what a sample is copied for.

  // "in that amountand we plan" — a stand-in welded to the next word. The
  // ordinal and the decade are the same defect on the other end of the figure,
  // and the `amount\p{L}` guard below always could have caught them: the
  // original input simply never contained one.
  it.each([
    ["Work ends in 2035 and we plan through 2070.", "and we plan through"],
    ["The window opens January 1st and closes in June.", "and closes in June"],
    ["Most of the growth lands in the mid-2030s, not before.", "not before"],
  ])("leaves no letter welded to a stand-in: %s", (input, survives) => {
    const out = scrubSample(input, HOUSEHOLD);
    expect(out).toContain(survives);
    expect(out).not.toMatch(/amount\p{L}/u);
    expect(out).not.toMatch(/\d/u);
  });

  // A number that names a form is not a figure about anybody. Scrubbing it buys
  // no safety and costs the most common vocabulary in the corpus.
  it.each([
    ["Susan's 401(k) does most of the lifting.", "Their 401(k) does most of the lifting."],
    ["You opened a 529 for the kids.", "You opened a 529 for the kids."],
    ["The 1099 arrives before the 1040 is due.", "The 1099 arrives before the 1040 is due."],
  ])("keeps a term of art: %s", (input, expected) => {
    expect(scrubSample(input, HOUSEHOLD)).toBe(expected);
  });

  // Found the same way: `[\d,]*` ate the comma CLOSING a clause, so the sample
  // lost the punctuation that carries its rhythm.
  it("keeps the comma that ends a clause after a figure", () => {
    expect(scrubSample("Work ends in 2035, and we plan through 2070.", HOUSEHOLD)).toBe(
      "Work ends in that amount, and we plan through that amount.",
    );
  });

  // …and the other direction, which is what makes the exclusion safe: a real
  // figure that merely contains those digits must still go.
  it.each(["You hold $529K there.", "It costs $1,099 a year.", "You owe 401,000 on it."])(
    "still scrubs a figure that only looks like a form: %s",
    (input) => {
      expect(scrubSample(input, HOUSEHOLD)).not.toMatch(/\d/u);
    },
  );

  // "they and they, your plan holds." — and this is a COMMON case: addressing
  // both names is the one shape `prompts.ts` permits a name in at all.
  it("collapses a two-person address to one stand-in", () => {
    expect(scrubSample("Cooper and Susan, your plan holds.", HOUSEHOLD)).toBe(
      "They, your plan holds.",
    );
  });

  // Grammar is excused; capitalisation is not. This text's only job is to model
  // register, and a lowercase sentence opener is a register defect.
  it("capitalises a stand-in that opens a sentence", () => {
    expect(scrubSample("Cooper, here's the short version.", HOUSEHOLD)).toBe(
      "They, here's the short version.",
    );
    expect(scrubSample("It holds. Cooper asked us to check.", HOUSEHOLD)).toBe(
      "It holds. They asked us to check.",
    );
  });

  it("leaves a stand-in mid-sentence alone", () => {
    expect(scrubSample("We told Cooper it holds.", HOUSEHOLD)).toBe("We told they it holds.");
  });

  // A chapter is MARKDOWN, and a heading or a bullet is where most of its
  // sentences start. A rule that only knew about full stops left these two.
  it.each([
    ["## Cooper and Susan's Plan", "## Their Plan"],
    ["- Cooper owns the boat", "- They owns the boat"],
    ["1. Cooper owns the boat", "1. They owns the boat"],
    ["> Cooper owns the boat", "> They owns the boat"],
  ])("capitalises a stand-in after a markdown opener: %s", (input, expected) => {
    expect(scrubSample(input, HOUSEHOLD)).toBe(expected);
  });

  // Found by the ordered-list case above: the figure pass was eating the list
  // MARKER, so every numbered list came out as "That amount." A marker is
  // structure the model copies, and says nothing about a household.
  it("keeps an ordered-list marker, but not a figure that opens a line", () => {
    expect(scrubSample("1. You own the boat\n10. You owe nothing", HOUSEHOLD)).toBe(
      "1. You own the boat\n10. You owe nothing",
    );
    expect(scrubSample("2035 was the year.", HOUSEHOLD)).toBe("That amount was the year.");
    expect(scrubSample("1.5M is the total.", HOUSEHOLD)).toBe("That amount is the total.");
  });

  // The marker exemption is what a leaked timeline hides behind. Uncapped, a
  // model writing "2035. Work ends." got every year through the figure pass
  // untouched — a figure surviving the one pass that exists to remove figures.
  it.each([
    ["2035. Work ends then.", "That amount. Work ends then."],
    ["2035) Work ends then.", "That amount) Work ends then."],
    ["  2035. Work ends then.", "That amount. Work ends then."],
  ])("scrubs a year that is dressed as a list marker: %s", (input, expected) => {
    expect(scrubSample(input, HOUSEHOLD)).toBe(expected);
  });

  // Indentation is what nests a list in CommonMark. Flattened, these three are
  // siblings, and the sample teaches a structure the advisor never wrote.
  it("keeps the indentation that nests a list", () => {
    const nested = "- Cooper owns the boat\n  - Susan owns the house\n    - and the barn";
    expect(scrubSample(nested, HOUSEHOLD)).toBe(
      "- They owns the boat\n  - They owns the house\n    - and the barn",
    );
  });

  /**
   * `lastName` is nullable (`engine/types.ts`) and `load-context.ts` falls back
   * to the FIRST name, so a real client with no surname on file has a household
   * called "the Cooper household" — the household name and a given name are then
   * the SAME WORD, and whichever pass runs first consumes it.
   */
  describe("when the household name is built from the first name", () => {
    const NO_SURNAME = { firstNames: "Cooper", householdName: "the Cooper household" };

    it("still reads as a household, not as a person", () => {
      expect(scrubSample("This is what the Cooper household owns.", NO_SURNAME)).toBe(
        "This is what the household owns.",
      );
    });

    // …and the other half: the same word addressing the PERSON still gets the
    // person's stand-in, which is why the framed pass requires its framing.
    it("still reads as a person when it is used as one", () => {
      expect(scrubSample("Cooper, your plan holds.", NO_SURNAME)).toBe("They, your plan holds.");
    });
  });

  // …but two figures are two figures. Collapsing them would eat half a sentence.
  it("keeps both halves of a range", () => {
    expect(scrubSample("You land between $2M and $3M.", HOUSEHOLD)).toBe(
      "You land between that amount and that amount.",
    );
  });

  // "they's 401(k)" — Gate 6 permits the possessive by design, so a harvested
  // chapter contains it.
  it("writes a possessive as a possessive", () => {
    const out = scrubSample("Susan's account does the lifting.", HOUSEHOLD);
    expect(out).toBe("Their account does the lifting.");
  });
});
