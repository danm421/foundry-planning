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
