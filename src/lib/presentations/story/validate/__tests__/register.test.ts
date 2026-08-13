import { describe, it, expect } from "vitest";
import { validateLabels, registerGate } from "../register";
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

  /**
   * The other half of two-sidedness, and the case that broke a SHIPPED test the
   * first time this gate ran: a pack may hold a label that is just two ordinary
   * words. "Your net worth is $3.4M today" is prose an advisor writes, and a
   * gate that rejects it burns the chapter's only retry.
   */
  const SHORT = [moneyFact("today.netWorth", "Net worth", 2_100_000)];

  it("accepts an ordinary short label used as English", () => {
    expect(validateLabels("Your net worth is $3.4M today.", SHORT)).toEqual([]);
  });

  it("still rejects a short label printed as the pack line itself", () => {
    expect(validateLabels("Net worth: $2.1M, and it grows from there.", SHORT)).toHaveLength(1);
  });
});

const NAMES = ["Cooper", "Susan"];
const gate = registerGate(NAMES);

describe("Gate 6a — meta-narration", () => {
  // THE RED — every one verbatim from the 2026-08-12 audit.
  it("rejects a sentence that describes the page", () => {
    const failures = gate("This page is the punchline. You own $4.7M.", FACTS);
    expect(failures.some((f) => f.gate === "register")).toBe(true);
  });

  it("rejects a sentence that describes the chapter's own job", () => {
    expect(gate("This part of the plan starts with your balance sheet.", FACTS)).not.toEqual([]);
  });

  it("rejects a closing that explains why the page exists", () => {
    expect(gate("That's why this one-page view matters to you.", FACTS)).not.toEqual([]);
  });

  it("rejects 'this summary shows'", () => {
    expect(gate("This one-page summary says the plan holds up.", FACTS)).not.toEqual([]);
  });

  // THE GREEN — "this" and "page" are ordinary words in a financial chapter.
  it("accepts 'this' pointing at something in the plan", () => {
    expect(gate("This change moves your confidence up. That's the one that matters.", FACTS)).toEqual(
      [],
    );
  });

  it("accepts a reference to a page of the report that is NOT self-reference", () => {
    // frontMatter chapters legitimately point forward.
    expect(gate("The detail behind that sits on the pages that follow.", FACTS)).toEqual([]);
  });
});

describe("Gate 6b — third person about the reader", () => {
  // THE RED.
  it("rejects the reader described as 'a household'", () => {
    expect(gate("It shows a household with $4.7M of assets.", FACTS)).not.toEqual([]);
  });

  it("rejects 'the household' as the subject", () => {
    expect(gate("The household keeps the same finish across the plan.", FACTS)).not.toEqual([]);
  });

  it("rejects a first name used as a third party", () => {
    expect(gate("For Cooper and Susan, that means a wider margin.", FACTS)).not.toEqual([]);
  });

  // THE GREEN — the prompt explicitly allows the names ONCE, in direct address.
  it("accepts a name in direct address at the head of a sentence", () => {
    expect(gate("Cooper and Susan, your plan holds up. You own $6.7M.", FACTS)).toEqual([]);
  });

  it("accepts second-person prose with no names at all", () => {
    expect(gate("You own $4.7M and owe $610K. The difference is yours to work with.", FACTS)).toEqual(
      [],
    );
  });

  it("accepts 'your household' — the possessive is second person", () => {
    expect(gate("Your household spends about that much a year.", FACTS)).toEqual([]);
  });

  /**
   * A two-person household has two sets of accounts, and the only way to say
   * which is which is to name the owner. Measured on Cooper & Susan 2026-08-12:
   * the recommendation chapter was rejected twice for "Susan's 401(k)
   * contributions are set to 100% Roth" — prose with no alternative phrasing,
   * and a note the model could not act on. The possessive attaches the name to a
   * THING; third person attaches it to the reader.
   */
  it("accepts a possessive name — it says whose account it is", () => {
    expect(gate("Susan's 401(k) goes in as 100% Roth, so the tax is paid now.", FACTS)).toEqual([]);
    expect(gate("You fund Cooper’s Roth IRA at the limit through 2034.", FACTS)).toEqual([]);
  });

  it("still rejects the same name in the nominative", () => {
    expect(gate("Susan keeps the same finish across the plan.", FACTS)).not.toEqual([]);
  });
});
