import { describe, it, expect } from "vitest";
import { validateLabels } from "../register";
import { moneyFact, pctFact, yearFact } from "../../facts";

const FACTS = [
  moneyFact("outcome.legacy.base", "Left at the end, current plan", 9_200_000),
  pctFact("outcome.confidence.base", "Confidence, current plan", 1),
  yearFact("plan.retirementYear", "The year you stop working", 2013),
  moneyFact("today.netWorth", "Net worth today", 6_700_000),
];

describe("Gate 5 — fact-label leakage", () => {
  // THE RED. Both of these are verbatim from the 2026-08-12 audit.
  it("rejects a label read aloud with a colon", () => {
    const bad = "Left at the end, current plan: $9.2M, and the plan holds.";
    const failures = validateLabels(bad, FACTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].gate).toBe("labels");
    // The message quotes the LOWERCASED label deliberately: that is the string
    // the model can search its own draft for, and the match is case-insensitive.
    expect(failures[0].message).toContain("left at the end, current plan");
  });

  it("rejects a label welded into a sentence with 'is'", () => {
    const bad = "In the current path, left at the end, current plan is $4.5M.";
    expect(validateLabels(bad, FACTS)).toHaveLength(1);
  });

  it("rejects a label used as a noun phrase mid-sentence", () => {
    const bad = "The timeline starts with the year you stop working: 2013.";
    expect(validateLabels(bad, FACTS)).toHaveLength(1);
  });

  // THE GREEN, and the two-sided half: ordinary advisor prose that happens to
  // share words with a label must pass, or the gate burns the single retry.
  it("accepts prose that says the same thing in its own words", () => {
    const good =
      "Your plan ends with about $9.2M left over. You stop working in 2013, and we run the numbers through 2051.";
    expect(validateLabels(good, FACTS)).toEqual([]);
  });

  it("accepts a label's individual words scattered across a sentence", () => {
    const good = "What's left at the end depends on the plan you pick.";
    expect(validateLabels(good, FACTS)).toEqual([]);
  });

  it("reports each leaked label once, however often it appears", () => {
    const bad =
      "Left at the end, current plan: $9.2M. Later: left at the end, current plan: $9.2M again.";
    expect(validateLabels(bad, FACTS)).toHaveLength(1);
  });

  it("returns nothing for an empty pack", () => {
    expect(validateLabels("Anything at all goes here.", [])).toEqual([]);
  });
});
