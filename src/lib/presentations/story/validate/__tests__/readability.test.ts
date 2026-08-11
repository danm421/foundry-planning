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

  it("G2e — measures a bulleted chapter by line, not welded into one sentence", () => {
    // A heading and a bullet carry no full stop, so splitting on `.!?` alone
    // welds five short lines into one forty-word "sentence" and rejects plain,
    // readable client prose.
    const md = [
      "## What your plan shows",
      "",
      "- Your money lasts through age ninety five with room to spare",
      "- Your travel goal is fully funded in every year we tested",
      "- Your taxes stay inside the twelve percent bracket until seventy",
    ].join("\n");
    expect(validateReadability(md, [])).toEqual([]);
  });

  it("G2f — a gloss on a later line does not cover a term on an earlier one", () => {
    // Same welding bug, fail-open direction: the parenthesis belongs to the
    // second bullet and explains nothing about the first.
    const md = "- Your money sits in a tax-deferred account\n- Growth (the part that compounds) matters most";
    const failures = validateReadability(md, []);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("tax-deferred");
  });

  it("G2g — accepts the other ways a gloss is punctuated", () => {
    // Rejecting a correctly glossed term burns the chapter's one retry on prose
    // that is already right.
    const glossed = [
      "We looked at sequence-of-returns risk – the danger of a bad market right after you stop working.",
      "We looked at decumulation: the years you spend the money you saved.",
      "We looked at decumulation, meaning the years you spend what you saved.",
      "We looked at a drawdown, i.e. a fall from the peak.",
    ];
    for (const md of glossed) {
      expect(validateReadability(md, []), md).toEqual([]);
    }
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

  it("G3d — judges each sentence on its own", () => {
    // Testing the whole document at once lets a "you should" in one sentence
    // pair with a "move" in the next and reject prose that advises nothing.
    const md = "You should feel confident about this. The plan will move money into bonds later.";
    expect(validateNoAdvice(md, [])).toEqual([]);
  });

  it("G3e — finds an instruction on a later line of the chapter", () => {
    // A document-wide test anchors `^` to the first character, so only the
    // opening line can ever read as an imperative.
    const md = "## What changed\n\n- Your taxes fall in 2030\n- Sell your Apple shares this year";
    expect(validateNoAdvice(md, [])).toHaveLength(1);
  });

  it("G3f — a frame only counts when it governs the verb", () => {
    // Asking whether a frame and an action each appear *somewhere* in the
    // sentence rejects ordinary prose: every sentence below has both halves and
    // instructs nobody.
    const observations = [
      "If you want to sell the house, the plan improves.",
      "You could retire at sixty two, and the plan still moves money into bonds.",
      "You want to know whether the plan can move you to bonds safely.",
      "You can see that the plan moves money into bonds.",
    ];
    for (const md of observations) {
      expect(validateNoAdvice(md, []), md).toEqual([]);
    }
    // The same frames with the verb where the frame governs it.
    for (const md of ["You can sell your Apple shares now.", "You may want to sell your Apple shares."]) {
      expect(validateNoAdvice(md, []), md).toHaveLength(1);
    }
  });

  it("G3g — catches the sibling forms of every instruction the suite pins", () => {
    // Each is a one-token edit of a case already proven caught, and each one
    // instructs the reader to trade a specific holding.
    const cases = [
      "+ Sell your Apple shares.",
      "We would suggest selling your Apple shares.",
      "Your next step is to sell the Apple position.",
      "Consider trimming your Apple position.",
      "Rebalance your portfolio into sixty forty this year.",
      "Convert your IRA to a Roth this year.",
      "Roll your 401k into an IRA before December.",
      "You should shift twenty percent of your portfolio into bonds.",
    ];
    for (const md of cases) {
      expect(validateNoAdvice(md, []), md).toHaveLength(1);
    }
  });

  it("G3h — leaves noun phrases that open with an action word alone", () => {
    expect(validateNoAdvice("Purchase price on the house was four hundred thousand dollars.", [])).toEqual([]);
    expect(validateNoAdvice("Buy-and-hold investing keeps your costs low.", [])).toEqual([]);
  });

  it("G3j — a conditional clause does not exempt the instruction after it", () => {
    // The conditional guard exempts the FRAME; the main clause is still an
    // instruction, and an imperative anchored to the start of the sentence
    // never reaches it. Without per-clause checking, any conditional prefix is
    // a way through the gate.
    const instructions = [
      "If you want to reduce risk, sell your Apple shares.",
      "When you can, sell your Apple shares.",
      "Unless you want to pay more tax, move the bond fund into cash.",
      "Because you need to raise cash, sell your Apple shares.",
      "You want to reduce risk, so sell your Apple shares.",
    ];
    for (const md of instructions) {
      expect(validateNoAdvice(md, []), md).toHaveLength(1);
    }
    // …and the other side of the same constraint: a conditional whose main
    // clause states an outcome rather than an instruction still passes.
    const observations = [
      "If you want to sell the house, the plan improves.",
      "You could retire at sixty two, and the plan still moves money into bonds.",
      "The proposed plan, converting your IRA to a Roth, raises your confidence.",
      "Over the next ten years, moves in the market will not change the answer.",
    ];
    for (const md of observations) {
      expect(validateNoAdvice(md, []), md).toEqual([]);
    }
  });

  it("G3k — an option is a holding, not a noun phrase", () => {
    // The compound-noun list may not name anything a client can own.
    const instructions = [
      "Sell options in your account.",
      "Buy options on the position.",
      "Liquidate options now.",
      "Sell option contracts.",
    ];
    for (const md of instructions) {
      expect(validateNoAdvice(md, []), md).toHaveLength(1);
    }
    // The words that are genuinely noun heads must keep passing.
    expect(validateNoAdvice("Purchase price on the house was four hundred thousand dollars.", [])).toEqual([]);
  });

  it("G3i — reports every offending sentence, not just the first", () => {
    // One retry, one message: a chapter with three instructions must not spend
    // it fixing a third of them.
    const md = "Sell your Apple shares.\nBuy bonds instead.\nYour money lasts.";
    const failures = validateNoAdvice(md, []);
    expect(failures).toHaveLength(2);
    expect(failures[1].message).toContain("Buy bonds instead.");
  });
});
