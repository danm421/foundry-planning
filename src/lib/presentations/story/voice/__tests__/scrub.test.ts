import { describe, it, expect } from "vitest";
import { scrubSample } from "../scrub";

const HOUSEHOLD = { firstNames: "Cooper and Susan", householdName: "the Sample household" };

describe("scrubSample", () => {
  it("removes the household's first names", () => {
    expect(scrubSample("Cooper, your plan holds up.", HOUSEHOLD)).not.toContain("Cooper");
  });

  it("removes the household name", () => {
    expect(scrubSample("This is what the Sample household owns.", HOUSEHOLD)).not.toContain("Sample");
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

  // "in that amountand we plan" — a stand-in welded to the next word.
  it("leaves a space where a figure had one", () => {
    const out = scrubSample("Work ends in 2035 and we plan through 2070.", HOUSEHOLD);
    expect(out).toContain("and we plan through");
    expect(out).not.toMatch(/amount\p{L}/u);
  });

  // "they and they, your plan holds." — and this is a COMMON case: addressing
  // both names is the one shape `prompts.ts` permits a name in at all.
  it("collapses a two-person address to one stand-in", () => {
    expect(scrubSample("Cooper and Susan, your plan holds.", HOUSEHOLD)).toBe(
      "they, your plan holds.",
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
    expect(out).toBe("their account does the lifting.");
  });
});
