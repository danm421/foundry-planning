import { describe, it, expect } from "vitest";
import { extractFigures, validateFacts } from "../facts";
import { moneyFact, pctFact, yearFact } from "../../facts";

const FACTS = [
  moneyFact("liquid", "Liquid assets", 2_100_000),   // "$2.1M"
  pctFact("conf.base", "Confidence, today", 0.73),   // "73%"
  pctFact("conf.prop", "Confidence, proposed", 0.91),// "91%"
  yearFact("retire", "Retirement year", 2041),       // "2041"
];

describe("extractFigures", () => {
  it("pulls dollars, percentages, and four-digit years out of markdown", () => {
    const found = extractFigures("You have $2.1M today, 73% confidence, retiring in 2041.");
    expect(found).toEqual(expect.arrayContaining(["$2.1M", "73%", "2041"]));
  });

  it("ignores ages and small counts", () => {
    expect(extractFigures("Both of you turn 62 next year, and there are 3 accounts.")).toEqual([]);
  });
});

describe("validateFacts", () => {
  it("passes prose that only uses supplied figures", () => {
    const md = "Your $2.1M today supports the plan, and confidence rises from 73% to 91%.";
    expect(validateFacts(md, FACTS)).toEqual([]);
  });

  // THE MUTATION PROOF. A validator that returns [] unconditionally passes
  // every other test in this file. This is the one that must go red first.
  it("REJECTS a fabricated dollar figure that is not in the fact pack", () => {
    const md = "Your $2.1M today grows to $3.4M by retirement.";
    const failures = validateFacts(md, FACTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].gate).toBe("facts");
    expect(failures[0].message).toContain("$3.4M");
  });

  it("REJECTS a fabricated percentage", () => {
    const failures = validateFacts("Confidence climbs to 96%.", FACTS);
    expect(failures.map((f) => f.message).join(" ")).toContain("96%");
  });

  it("REJECTS a year that is not in the fact pack", () => {
    const failures = validateFacts("You retire in 2038.", FACTS);
    expect(failures.map((f) => f.message).join(" ")).toContain("2038");
  });

  it("reports every distinct fabrication once, not once per occurrence", () => {
    const failures = validateFacts("First $3.4M, then $3.4M again.", FACTS);
    expect(failures).toHaveLength(1);
  });
});

// A model that wants to state a number it was not given does not announce it.
// Each case below was a live, verified bypass of the first implementation:
// prose a client would read as a hard figure, waved straight through.
describe("validateFacts — evasions", () => {
  const NEGATIVE_FACTS = [
    moneyFact("gap", "Shortfall", -2_100_000), // "$-2.1M"
    pctFact("drift", "Confidence change", -0.12), // "-12%"
  ];

  it("C1 — catches money-shaped figures written without a dollar sign", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["Liquid assets of 2,100,000 today.", "2,100,000"],
      ["Your plan reaches 3,400,000 USD.", "3,400,000 USD"],
      ["Your plan grows to 3.4 million dollars by retirement.", "3.4 million dollars"],
      ["Your plan grows to 3.4M by retirement.", "3.4M"],
      ["Your plan reaches 3400000 by retirement.", "3400000"],
    ];
    for (const [md, quoted] of cases) {
      const failures = validateFacts(md, FACTS);
      expect(failures, md).toHaveLength(1);
      expect(failures[0].message, md).toContain(quoted);
    }
  });

  it("C2 — sees through markdown emphasis placed inside a figure", () => {
    const md = "Your liquid assets of $**2.1M** anchor the plan; by 20**41** they reach $**3.4M**.";
    const failures = validateFacts(md, FACTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("$3.4M");

    expect(validateFacts("Confidence climbs to **96**%.", FACTS)[0].message).toContain("96%");
    expect(validateFacts("You retire in 20**38**.", FACTS)[0].message).toContain("2038");
    // Emphasis outside the sigil always worked, and must keep working.
    expect(validateFacts("Your **$2.1M** anchors the plan.", FACTS)).toEqual([]);
  });

  it("C3 — catches a fabricated negative dollar figure", () => {
    const failures = validateFacts("A shortfall of $-3.4M appears.", FACTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("$-3.4M");
  });

  it("C3 — accepts a supplied negative, in either sign position", () => {
    // The other direction of the same bug: rejecting these would burn the one
    // retry on prose that is entirely correct.
    expect(validateFacts("The gap is $-2.1M.", NEGATIVE_FACTS)).toEqual([]);
    expect(validateFacts("The gap is -$2.1M.", NEGATIVE_FACTS)).toEqual([]);
    expect(validateFacts("Confidence moves -12%.", NEGATIVE_FACTS)).toEqual([]);
  });

  it("I1 — catches a percentage separated from its sign by a space", () => {
    expect(validateFacts("Confidence climbs to 96 %.", FACTS)[0].message).toContain("96 %");
    expect(validateFacts("Confidence climbs to 96 %.", FACTS)).toHaveLength(1);
  });

  it("I2 — folds unicode look-alikes to their ASCII forms", () => {
    expect(extractFigures("＄3.4M")).toEqual(["$3.4M"]); // fullwidth dollar
    expect(extractFigures("96％")).toEqual(["96%"]); // fullwidth percent
    expect(extractFigures("96﹪")).toEqual(["96%"]); // small percent
    expect(extractFigures("$３.４M")).toEqual(["$3.4M"]); // fullwidth digits
    expect(extractFigures("−3.4M")).toEqual(["-3.4M"]); // U+2212 minus
    expect(validateFacts("A gap of −3.4M appears.", FACTS)).toHaveLength(1);
  });

  it("M1 — quotes the whole figure the model actually wrote", () => {
    // The message is reused verbatim in the retry prompt, so quoting a
    // truncated "$3.4" would tell the model to fix a string it never wrote.
    const failures = validateFacts("Your plan grows to $3.4m.", FACTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("$3.4m");
  });

  it("deliberately over-fires on year-shaped numbers that are not years", () => {
    // Documented and accepted. This rejects valid prose, costing a retry and at
    // worst the deterministic fallback — the safe direction. Do not "fix" it by
    // narrowing the year branch; that would let a fabricated year through.
    expect(validateFacts("The house is 2000 square feet.", FACTS)).toHaveLength(1);
    expect(validateFacts("See IRC section 2010.", FACTS)).toHaveLength(1);
  });
});
