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

  /**
   * ⚠️ The first real harvest, 2026-08-14. A kind-blind stand-in stored "Work
   * income stops in that amount. The plan runs to that amount." — and the prompt
   * line directly above the samples orders the model to "copy their rhythm and
   * register". Six "that amount"s in one passage IS a rhythm, and it is not the
   * advisor's. The stand-in has to leave a sentence that is still English.
   */
  it.each([
    ["Work income stops in 2035.", "Work income stops in that year."],
    ["After 2035 the paychecks stop and the portfolio takes over.", "After that year the paychecks stop and the portfolio takes over."],
    ["The plan runs to 2070.", "The plan runs to that year."],
    ["The confidence level is 91%.", "The confidence level is that rate."],
    ["It grows at 6.5% a year.", "It grows at that rate a year."],
    ["You own $4.7M and owe $610K.", "You own that amount and owe that amount."],
  ])("matches the stand-in to the KIND of figure: %s", (input, expected) => {
    expect(scrubSample(input, HOUSEHOLD)).toBe(expected);
  });

  // ⭐ The safety half, and the reason the kinds are decided from the figure's
  // own SHAPE rather than from where it sits: the kind changes the WORD and
  // never the coverage. Nothing here is a hole a figure can leave through.
  it("removes every figure whatever kind it is", () => {
    const out = scrubSample("2035, 91%, $4.7M, 480k, 1,200, 12 and 73.7% — all of it.", HOUSEHOLD);
    expect(out).not.toMatch(/\d/u);
    expect(out).not.toMatch(/[$%]/u);
    expect(out).toContain("all of it");
  });

  // A year is four digits and NOTHING else: a currency mark, a thousands
  // separator or a decimal point each mean the digits are a quantity that merely
  // reads like a year. The separator and the point are the ones the bareness test
  // itself has to catch — a currency mark is already decided a line above it.
  it.each([
    ["It costs $2035 a month.", "It costs that amount a month."],
    ["It costs 2,035 a month.", "It costs that amount a month."],
    ["It grew to 2035.40 by then.", "It grew to that amount by then."],
    // A magnitude letter says money whichever case an advisor writes it in. The
    // letter reaches the kind test as part of the figure STRING — `SCRUBBABLE` is
    // compiled `giu`, so its own `[KMB]` matches either case — and a
    // case-sensitive kind test read "2035k" as a year. The first and third are
    // controls: they passed before that fix and after it.
    ["It holds 2035K of them.", "It holds that amount of them."],
    ["It holds 2035k of them.", "It holds that amount of them."],
    ["It holds 2035 k of them.", "It holds that amount of them."],
    ["Work ends in 2035.", "Work ends in that year."],
  ])("reads four bare digits as a year and anything else as an amount: %s", (input, expected) => {
    expect(scrubSample(input, HOUSEHOLD)).toBe(expected);
  });

  // Capitalisation is the one thing grammar is not excused on — same rule as the
  // name stand-in, and every kind has to obey it or the register breaks.
  it("capitalises a kind stand-in that opens a sentence", () => {
    expect(scrubSample("2035 was when work ended.", HOUSEHOLD)).toBe("That year was when work ended.");
    expect(scrubSample("It holds. 91% is the confidence.", HOUSEHOLD)).toBe(
      "It holds. That rate is the confidence.",
    );
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
    // Every kind of stand-in, not just the amount — a guard that named one word
    // would stop covering the two years in the first case below.
    expect(out).not.toMatch(/that (?:amount|year|rate)\p{L}/iu);
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
      "Work ends in that year, and we plan through that year.",
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
    expect(scrubSample("2035 was when work ended.", HOUSEHOLD)).toBe("That year was when work ended.");
    expect(scrubSample("1.5M is the total.", HOUSEHOLD)).toBe("That amount is the total.");
  });

  // The marker exemption is what a leaked timeline hides behind. Uncapped, a
  // model writing "2035. Work ends." got every year through the figure pass
  // untouched — a figure surviving the one pass that exists to remove figures.
  it.each([
    ["2035. Work ends then.", "That year. Work ends then."],
    ["2035) Work ends then.", "That year) Work ends then."],
    ["  2035. Work ends then.", "That year. Work ends then."],
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

  /**
   * ⚠️ The collapse cannot tell a stand-in this module inserted from the same
   * words the advisor typed, and the kind stand-ins widened that: "that year" and
   * "that rate" are ordinary English an advisor writes, where "that amount" mostly
   * is not. An appositive therefore loses its middle. Every output below still
   * reads as English, and what goes is the figure being glossed — which had to go
   * anyway — so this pins the shape as a decision rather than leaving it a
   * surprise for the next reader.
   */
  it.each([
    ["In that year, 2035, work ends.", "In that year, work ends."],
    ["It grows at that rate, 6.5%, every year.", "It grows at that rate, every year."],
    ["You owe that amount, $610K, on the house.", "You owe that amount, on the house."],
  ])("collapses an advisor's own stand-in words into the figure beside them: %s", (input, expected) => {
    expect(scrubSample(input, HOUSEHOLD)).toBe(expected);
  });

  // …and the control that stops the case above being read as the figure pass
  // eating a clause: put a word between the two and both halves survive.
  it("keeps an advisor's stand-in words when something separates them from the figure", () => {
    expect(scrubSample("In that year, and in 2035, work ends.", HOUSEHOLD)).toBe(
      "In that year, and in that year, work ends.",
    );
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
