import { describe, it, expect } from "vitest";
import { splitSentences, validateReadability, validateNoAdvice } from "../readability";

describe("splitSentences", () => {
  it("splits on sentence-ending punctuation and drops empties", () => {
    expect(splitSentences("One. Two! Three?  ")).toEqual(["One.", "Two!", "Three?"]);
  });
});

describe("validateReadability", () => {
  it("passes short, plain sentences", () => {
    expect(validateReadability("Your money lasts. That is the headline.", [])).toEqual([]);
  });

  it("REJECTS unglossed jargon", () => {
    const failures = validateReadability("We modelled sequence-of-returns risk carefully.", []);
    expect(failures).toHaveLength(1);
    expect(failures[0].gate).toBe("readability");
    expect(failures[0].message).toContain("sequence-of-returns");
  });

  it("accepts jargon that is glossed in the same sentence", () => {
    const md = "We looked at sequence-of-returns risk — the danger of a bad market right after you stop working.";
    expect(validateReadability(md, [])).toEqual([]);
  });

  it("REJECTS prose whose average sentence runs long", () => {
    const long = `${"word ".repeat(40)}end.`;
    const failures = validateReadability(long, []);
    expect(failures.map((f) => f.message).join(" ")).toContain("sentences are too long");
  });

  it("REJECTS a nested heading", () => {
    const failures = validateReadability("## Overview\n\n### Detail\n\nText.", []);
    expect(failures.map((f) => f.message).join(" ")).toContain("heading");
  });
});

describe("validateNoAdvice", () => {
  it("passes an observation", () => {
    expect(validateNoAdvice("Delaying the benefit raises the monthly amount.", [])).toEqual([]);
  });

  it("REJECTS an instruction to buy or sell", () => {
    const failures = validateNoAdvice("You should sell your Apple shares this year.", []);
    expect(failures).toHaveLength(1);
    expect(failures[0].gate).toBe("advice");
  });
});

// Each case below was a live, verified bypass of the first implementation:
// prose a client would actually read, waved straight through by a gate whose
// stated job was to stop it.
describe("validateReadability — evasions", () => {
  it("G2a — a dash or parenthesis that explains something else is not a gloss", () => {
    const cases = [
      "Your withdrawals — steady and predictable — come from a tax-deferred account.",
      "Your withdrawals (steady and predictable) come from a tax-deferred account.",
    ];
    for (const md of cases) {
      expect(validateReadability(md, []), md).toHaveLength(1);
    }
    // The real gloss follows the term, and must keep passing.
    expect(validateReadability("A drawdown (a fall from the peak) is normal.", [])).toEqual([]);
  });

  it("G2b — catches the term however it is spelled or emphasised", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["We modelled sequence of returns risk carefully.", "sequence-of-returns"],
      ["Your money sits in a tax deferred account.", "tax-deferred"],
      ["We modelled de**cumulation** carefully.", "decumulation"],
      ["Your money sits in a tax-**deferred** account.", "tax-deferred"],
      ["We modelled Sequence-Of-Returns risk carefully.", "sequence-of-returns"],
    ];
    for (const [md, term] of cases) {
      const failures = validateReadability(md, []);
      expect(failures, md).toHaveLength(1);
      expect(failures[0].message, md).toContain(term);
    }
  });

  it("G2c — catches one runaway sentence hiding behind a short average", () => {
    // Three short sentences pull the mean to 17 words, under the limit; the
    // sixty-word sentence between them is still unreadable.
    const md = `Your money lasts. That is good. ${"word ".repeat(59)}end. It all works.`;
    const failures = validateReadability(md, []);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("One sentence runs 60 words");
  });

  it("G2d — counts heading levels, not just hash marks", () => {
    // The nested heading a model actually writes is a title over a section,
    // neither of which is an `###`.
    expect(validateReadability("# Your plan\n\n## What changed\n\nText.", [])).toHaveLength(1);
    expect(validateReadability("## Overview\n\n   ### Detail\n\nText.", [])).toHaveLength(1);
    // One level, used repeatedly, is not nesting.
    expect(validateReadability("## Overview\n\nText.\n\n## Next\n\nMore text.", [])).toEqual([]);
  });
});

describe("validateNoAdvice — evasions", () => {
  it("G3a — catches a bare imperative, which carries no modal to match on", () => {
    const cases = [
      "Sell your Apple shares this year.",
      "Move your bond fund into cash.",
      "- Sell your Apple shares.",
    ];
    for (const md of cases) {
      const failures = validateNoAdvice(md, []);
      expect(failures, md).toHaveLength(1);
      expect(failures[0].gate, md).toBe("advice");
      // The message is reused verbatim in the retry prompt, so it names the
      // sentence to rewrite rather than the rule alone.
      expect(failures[0].message, md).toContain(md.replace(/^- /, ""));
    }
  });

  it("G3b — catches hedged and third-person recommendation frames", () => {
    const cases = [
      "Consider selling your Apple shares.",
      "We recommend selling your Apple shares.",
      "You may want to sell your Apple shares.",
      "You could sell your Apple shares.",
      "You'll want to move your bond fund.",
      "It makes sense to sell the position this year.",
    ];
    for (const md of cases) {
      expect(validateNoAdvice(md, []), md).toHaveLength(1);
    }
  });

  it("G3c — leaves observations and conditionals alone", () => {
    // The cost of over-firing here is a retry burned on prose that instructs
    // nobody, so these are as load-bearing as the rejections above.
    const cases = [
      "Selling the position would raise this year's tax.",
      "Moving to bonds lowers the swing in your balance.",
      "Switching to the proposed plan raises your confidence.",
      "If you sell the house, the plan improves.",
      "Delaying the benefit raises the monthly amount.",
    ];
    for (const md of cases) {
      expect(validateNoAdvice(md, []), md).toEqual([]);
    }
  });

  it("deliberately over-fires on a permissive 'you can' beside an action verb", () => {
    // Documented and accepted. This rejects a sentence that instructs nobody,
    // costing a retry and at worst the deterministic fallback — the safe
    // direction. Do not "fix" it by dropping `can` from the frame list; that
    // also lets "You can sell your Apple shares now" through.
    expect(validateNoAdvice("You can see that the plan moves money into bonds.", [])).toHaveLength(1);
  });

  it("G3d — judges each sentence on its own", () => {
    // Testing the whole document at once lets a "you should" in one sentence
    // pair with a "move" in the next and reject prose that advises nothing.
    const md = "You should feel confident about this. The plan will move money into bonds later.";
    expect(validateNoAdvice(md, [])).toEqual([]);
  });
});
