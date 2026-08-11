import { describe, it, expect } from "vitest";
import { sentenceLengthStdDev, validateVoice } from "../voice";

/** Ordinary advisor prose, appended so a one-line evasion case still has a
 *  rhythm the gate can read. Every tell case below is the tell PLUS this. */
const TAIL = " We looked hard at the years right after you stop working, and it came through fine.";
const CURLY = "’";
const NBSP = " ";

describe("sentenceLengthStdDev", () => {
  it("is near zero when every sentence is the same length", () => {
    expect(sentenceLengthStdDev("aa bb cc. dd ee ff. gg hh ii.")).toBeLessThan(0.5);
  });

  it("rises when sentence lengths vary", () => {
    expect(sentenceLengthStdDev("Yes. This one runs quite a lot longer than the first did.")).toBeGreaterThan(3);
  });

  // The exact value, not a band: a sample (n-1) divisor scores this 3.54 and a
  // missing square root scores it 6.25, and every band-shaped assertion in this
  // file accepts all three.
  it("is the population standard deviation, exactly", () => {
    const eightThenThirteen = "a b c d e f g h. a b c d e f g h i j k l m.";
    expect(sentenceLengthStdDev(eightThenThirteen)).toBeCloseTo(2.5, 10);
  });

  it("leaves a heading out of the measure — a heading is a label, not a sentence", () => {
    expect(sentenceLengthStdDev("## Your plan\n\naa bb cc. dd ee ff. gg hh ii.")).toBeLessThan(0.5);
  });

  // Three marked lines and one bare one, all three words long. A marker counted
  // as a word makes only SOME units longer, so the spread stops being zero —
  // which a corpus of uniformly-marked bullets could never show.
  it("counts the words in a bullet, not the bullet", () => {
    expect(sentenceLengthStdDev("1. aa bb cc\n> aa bb cc\n- aa bb cc\naa bb cc")).toBe(0);
  });
});

describe("validateVoice", () => {
  const human =
    "Your plan holds up. We looked hard at the years right after you stop working, because that is where a plan like yours usually strains, and it came through fine. Nothing here needs fixing today.";

  it("passes writing that varies its rhythm and avoids the tells", () => {
    expect(validateVoice(human, [])).toEqual([]);
  });

  // MUTATION PROOF — a no-op validator passes the "human" test above.
  it("REJECTS a canned AI opener", () => {
    const failures = validateVoice(`It's important to note that ${human}`, []);
    expect(failures).toHaveLength(1);
    expect(failures[0].gate).toBe("voice");
    expect(failures[0].message).toContain("It's important to note");
  });

  it("REJECTS the three-item parallel list", () => {
    const failures = validateVoice("The plan is clearer, simpler, and more effective than before.", []);
    expect(failures.map((f) => f.message).join(" ")).toContain("three-item");
  });

  it("REJECTS metronomic sentence lengths", () => {
    const flat = "We saw the plan work. You have the funds now. Your future looks fine. The money will last.";
    const failures = validateVoice(flat, []);
    expect(failures.map((f) => f.message).join(" ")).toContain("same length");
  });
});

// Every case below walked straight through the gate the plan specified. They
// are the same tell the plan already banned, wearing the punctuation, emphasis
// or whitespace a language model actually emits.
describe("validateVoice — evasions", () => {
  const evasions: Array<[string, string, string]> = [
    ["G4a-1 a curly apostrophe", `It${CURLY}s important to note that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-2 markdown emphasis inside the tell", `It's **important to note** that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-3 a line break inside the tell", `It's important\nto note that your plan holds.${TAIL}`, "It's important"],
    ["G4a-4 a non-breaking space inside the tell", `It's important${NBSP}to note that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-5 a doubled space inside the tell", `In  summary, your plan holds.${TAIL}`, "In  summary"],
    ["G4a-6 the inflected stem", `Delving into the numbers shows your plan holds.${TAIL}`, "Delving"],
    ["G4a-7 emphasis around a one-word tell", `We *delve* into the numbers here.${TAIL}`, "delve"],
    ["G4a-8 the spec's bare landscape", `The current tax landscape favours you here.${TAIL}`, "landscape"],
    ["G4a-9 the spec's robust", `Your plan is robust.${TAIL}`, "robust"],
    ["G4a-10 an opener with no comma after it", `Overall your plan holds up well.${TAIL}`, "Overall"],
    ["G4a-11 a stacked hedge", `The plan may potentially fall short in a bad decade.${TAIL}`, "may potentially"],
    ["G4b-1 a triad with a multi-word item", "The plan is clearer, far simpler, and more effective than before.", "three-item"],
    ["G4b-2 a triad wearing emphasis", "The plan is *clearer*, *simpler*, and *more effective* than before.", "three-item"],
    ["G4b-3 a triad split across a line break", "The plan is clearer,\nsimpler, and more effective than before.", "three-item"],
    ["G4b-4 a triad with a doubled space", "The plan is clearer,  simpler, and more effective than before.", "three-item"],
    ["G4b-5 a triad of plain adjectives", "The result is clear, simple, and effective.", "three-item"],
    [
      "G4c-1 metronomic prose behind a heading",
      "## Your plan\n\nWe saw the plan work. You have the funds now. Your future looks fine. The money will last.",
      "same length",
    ],
    [
      "G4c-2 metronomic bullets, which whole-document splitting reads as one sentence",
      "- The plan carries your spending through retirement\n- The accounts you hold today grow enough\n- The tax you pay stays inside the band\n- The money remaining leaves a legacy",
      "same length",
    ],
    [
      "G4c-3 long sentences in a tight band, which a fixed standard deviation misses",
      "The plan holds your spending for the whole of retirement. Your accounts keep growing for another decade after that. The tax you pay lands inside the expected band. What remains at the end covers the legacy.",
      "same length",
    ],
  ];

  for (const [name, markdown, expected] of evasions) {
    it(`REJECTS ${name}`, () => {
      const failures = validateVoice(markdown, []);
      expect(failures).toHaveLength(1);
      expect(failures[0].gate).toBe("voice");
      expect(failures[0].message).toContain(expected);
    });
  }
});

// The other side of the constraint. A gate that rejects plain, correct prose
// burns the chapter's single retry on a note the model cannot act on, so these
// are as load-bearing as the rejections above.
describe("validateVoice — prose it must not touch", () => {
  const accepted: Array<[string, string]> = [
    [
      "bare 'overall' is ordinary financial English",
      "Your overall confidence sits at 91%. That is the number to hold on to when a bad quarter rattles you, because it already assumes several of them.",
    ],
    [
      "a list of holdings behind a preposition enumerates, it does not flourish",
      "Your money sits in cash, bonds, and stocks. None of that changes this year.",
    ],
    [
      "a list of accounts",
      "You hold three accounts we care about: your IRA, your 401(k), and your brokerage. Together they carry most of the plan.",
    ],
    ["a list of years", "In 2031, 2032, and 2033 the plan draws harder on the taxable account than it does anywhere else."],
    ["a list of names", "Anna, Ben, and Chloe are each named as beneficiaries. Nothing there needs changing."],
    [
      "one hedge is how a careful advisor writes",
      "The plan may not last if you spend at last year's pace. We modelled that, and the gap shows up in your late seventies.",
    ],
    [
      "two sentences of equal length is a coincidence, not a rhythm",
      "The plan may not last if you spend at that pace. We modelled it, and the gap shows in your late seventies.",
    ],
    [
      "the app's own narrative prose",
      "The plan has 91% plan confidence, ending with about $2.1M in liquid assets. Projected spending exceeds available funding by $400K over retirement, a shortfall the plan does not currently cover. Social Security is the largest funding source, covering 38% of lifetime retirement spending. Roth assets make up 12% of the retirement-year portfolio, a tax-free reserve for later-life or legacy needs.",
    ],
    ["three deliberately short sentences", "You are fine. The money lasts. Nothing here needs fixing."],
    [
      "a bulleted chapter",
      "## What you have\n\n- Your cash and savings, about $40K\n- The retirement accounts, which carry most of the balance\n- The house, now paid off\n\nYour money lasts. That is the headline, and it is the only number that really matters here.",
    ],
    [
      "'conclusion' and 'summarize' as ordinary words",
      "We reached that conclusion the slow way. Every scenario we ran ended with money left over, which is not something we can say for most plans this size.",
    ],
  ];

  for (const [name, markdown] of accepted) {
    it(`passes ${name}`, () => {
      expect(validateVoice(markdown, [])).toEqual([]);
    });
  }
});
