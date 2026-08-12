import { describe, it, expect } from "vitest";
import { extractFigures, validateFacts } from "../facts";
import { moneyFact, pctFact, yearFact } from "../../facts";

const FACTS = [
  moneyFact("liquid", "Liquid assets", 2_100_000),   // "$2.1M"
  pctFact("conf.base", "Confidence, today", 0.73),   // "73%"
  pctFact("conf.prop", "Confidence, proposed", 0.91),// "91%"
  yearFact("retire", "Retirement year", 2041),       // "2041"
  // Both year facts, because `build-facts.ts#buildStoryFacts` always emits both
  // (`plan.retirementYear`, `plan.endOfLifeYear`) — which is what makes the
  // year-beside-a-money-noun case below reachable on every real client.
  yearFact("end", "End of life year", 2071),         // "2071"
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

  it("reads a hyphen between two supplied figures as a range, not a negative", () => {
    // This app's money format ends in a letter ($2.1M), so a range written with
    // a tight hyphen puts a "-" directly before the second figure. Reading that
    // as a negative rejects correct prose and, when the second figure really is
    // fabricated, quotes a minus sign the model never wrote.
    const RANGE_FACTS = [
      moneyFact("low", "Low", 2_100_000), // "$2.1M"
      moneyFact("high", "High", 3_400_000), // "$3.4M"
      pctFact("from", "From", 0.73), // "73%"
      pctFact("to", "To", 0.91), // "91%"
      yearFact("start", "Start", 2041),
      yearFact("end", "End", 2065),
    ];
    expect(validateFacts("Assets range $2.1M-$3.4M.", RANGE_FACTS)).toEqual([]);
    expect(validateFacts("Confidence moves 73%-91%.", RANGE_FACTS)).toEqual([]);
    expect(validateFacts("The window is 2041-2065.", RANGE_FACTS)).toEqual([]);

    // A fabricated second figure must still be caught, and quoted without a
    // sign the model never wrote.
    const failures = validateFacts("Assets range $2.1M-$9.9M.", RANGE_FACTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("$9.9M");
    expect(failures[0].message).not.toContain("-$9.9M");
  });

  it("keeps the sigil on a figure that follows a letter", () => {
    // Why the range guard is scoped to the sign rather than the whole branch:
    // a branch-level guard would drop the "$" here and quote a truncated "2.1M".
    expect(extractFigures("US$2.1M")).toEqual(["$2.1M"]);
    expect(validateFacts("Liquid assets are US$2.1M today.", FACTS)).toEqual([]);
  });

  it("I3 — catches a figure spelled out in words", () => {
    // The most natural evasion there is: the system prompt asks for warm,
    // conversational prose, and a model writing that way reaches for "about two
    // and a half million" without meaning to invent anything.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["Your plan grows to three point four million dollars.", "three point four million dollars"],
      ["Confidence climbs to ninety six percent.", "ninety six percent"],
      ["The gift is two hundred thousand dollars.", "two hundred thousand dollars"],
      ["You draw eight hundred dollars a month.", "eight hundred dollars"],
    ];
    for (const [md, quoted] of cases) {
      const failures = validateFacts(md, FACTS);
      expect(failures, md).toHaveLength(1);
      expect(failures[0].message, md).toContain(quoted);
    }
  });

  it("I3 — leaves number words that name no money alone", () => {
    // The other side of the same branch. Ages, counts and durations are not plan
    // outputs, and the model needs them to write naturally — so a number word is
    // only a figure when a money or percent noun follows it.
    expect(extractFigures("Both of you turn sixty two next year.")).toEqual([]);
    expect(extractFigures("We looked at three changes and two accounts.")).toEqual([]);
    expect(extractFigures("You retire in about ten years.")).toEqual([]);
    expect(extractFigures("The plan holds for one more decade.")).toEqual([]);
  });

  it("I4 — catches a bare four-digit number, which reads as a hard figure", () => {
    const failures = validateFacts("Your monthly benefit is 3400 a month.", FACTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("3400");
  });

  it("I4 — a year standing beside a money noun is a money figure, not a year", () => {
    // ORDERING REGRESSION. The year branch must sit BELOW the magnitude and unit
    // branches: a year is in every real pack, so a year branch that runs first
    // consumes the digits, the money noun beside them is never read, and an
    // invented dollar amount is waved through by the fact that the YEAR was
    // supplied. Both spellings, because both are what a model writes.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["You draw 2041 dollars a month.", "2041 dollars"],
      ["The gift was 2071 USD.", "2071 USD"],
      // …and the same ordering is what keeps a magnitude attached to its digits,
      // so the retry message quotes the figure the model actually wrote.
      ["Your plan grows to 2041 million dollars.", "2041 million dollars"],
    ];
    for (const [md, quoted] of cases) {
      const failures = validateFacts(md, FACTS);
      expect(failures, md).toHaveLength(1);
      expect(failures[0].message, md).toContain(quoted);
    }
  });

  it("I4 — leaves the year branch in charge of year-shaped numbers", () => {
    // Lowering the bare-integer floor to four digits puts it in reach of every
    // year, so the year branch has to keep precedence: a supplied year must
    // still be quoted as itself and must still be allowed.
    expect(extractFigures("You retire in 2041.")).toEqual(["2041"]);
    expect(validateFacts("You retire in 2041.", FACTS)).toEqual([]);
    expect(validateFacts("You retire in 2038.", FACTS)[0].message).toContain("2038");
  });

  it("deliberately over-fires on year-shaped numbers that are not years", () => {
    // Documented and accepted. This rejects valid prose, costing a retry and at
    // worst the deterministic fallback — the safe direction. Do not "fix" it by
    // narrowing the year branch; that would let a fabricated year through.
    expect(validateFacts("The house is 2000 square feet.", FACTS)).toHaveLength(1);
    expect(validateFacts("See IRC section 2010.", FACTS)).toHaveLength(1);
  });
});
