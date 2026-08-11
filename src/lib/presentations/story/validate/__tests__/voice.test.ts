import { describe, it, expect } from "vitest";
import { sentenceLengthStdDev, validateVoice } from "../voice";

/** Ordinary advisor prose, appended so a one-line evasion case still has a
 *  rhythm the gate can read. Every tell case below is the tell PLUS this. */
const TAIL = " We looked hard at the years right after you stop working, and it came through fine.";
/** Written as escapes, not literals: a reviewer cannot see a non-breaking space,
 *  and a literal one silently degrades to U+0020 when the file is edited. */
const NBSP = "\u00A0";
const RSQUO = "\u2019";
const LDQUO = "\u201C";
const RDQUO = "\u201D";
const EMDASH = "\u2014";
const ZWSP = "\u200B";

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

  // The heading is TWO words against three-word sentences. A three-word heading
  // would score zero whether it was dropped or counted, which is no test at all.
  it("leaves a heading out of the measure — a heading is a label, not a sentence", () => {
    expect(sentenceLengthStdDev("## Your plan\n\naa bb cc. dd ee ff. gg hh ii.")).toBe(0);
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

// The must-FAIL corpus, in full. Every case here walked straight through the
// gate the plan specified: the same tell it already banned, wearing the
// punctuation, emphasis or whitespace a language model actually emits.
//
// The message is asserted, not just the count — it is reused verbatim in the
// retry prompt, so it has to name a string the model can find in its own draft.
describe("validateVoice — evasions", () => {
  const evasions: Array<[string, string, string]> = [
    ["a canned opener", `It's important to note that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-1 a curly apostrophe", `It${RSQUO}s important to note that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-2 markdown emphasis inside the tell", `It's **important to note** that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-3 a line break inside the tell", `It's important\nto note that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-4 a non-breaking space inside the tell", `It's important${NBSP}to note that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-5 a doubled space inside the tell", `In  summary, your plan holds.${TAIL}`, "In summary"],
    ["G4a-5b a zero-width space splitting a word", `It's imp${ZWSP}ortant to note that your plan holds.${TAIL}`, "It's important to note"],
    ["G4a-6 a curly apostrophe in a second tell", `It${RSQUO}s worth noting that your plan holds.${TAIL}`, "It's worth noting"],
    ["G4a-7 a curly apostrophe in a third tell", `Here${RSQUO}s a breakdown of the numbers.${TAIL}`, "Here's a breakdown"],
    ["G4a-8 the inflected stem", `Delving into the numbers shows your plan holds.${TAIL}`, "Delving"],
    ["G4a-9 emphasis around a one-word tell", `We *delve* into the numbers here.${TAIL}`, "delve"],
    ["G4a-10 the spec's bare landscape", `The current tax landscape favours you here.${TAIL}`, "landscape"],
    ["G4a-11 the spec's robust", `Your plan is robust.${TAIL}`, "robust"],
    ["G4a-12 an opener with no comma after it", `Overall your plan holds up well.${TAIL}`, "Overall"],
    ["G4a-13 the same opener with its comma", `Overall, the plan holds up well.${TAIL}`, "Overall"],
    ["G4a-14 a stacked hedge", `The plan may potentially fall short in a bad decade.${TAIL}`, "may potentially"],
    ["G4b-1 a triad with a multi-word item", "The plan is clearer, far simpler, and more effective than before.", "three-item"],
    ["G4b-2 a triad wearing emphasis", "The plan is *clearer*, *simpler*, and *more effective* than before.", "three-item"],
    ["G4b-3 a triad split across a line break", "The plan is clearer,\nsimpler, and more effective than before.", "three-item"],
    ["G4b-4 a triad with a doubled space", "The plan is clearer,  simpler, and more effective than before.", "three-item"],
    ["G4b-5 a triad of plain adjectives", "The result is clear, simple, and effective.", "three-item"],
    ["G4b-6 a triad closed by 'or'", "The plan is clearer, simpler, or at the very least cheaper.", "three-item"],
    ["G4b-7 a triad whose items are quoted", 'The plan is "clearer", "simpler", and "more effective" than before.', "three-item"],
    [
      "G4b-8 a triad whose items wear curly quotes",
      `The plan is ${LDQUO}clearer${RDQUO}, ${LDQUO}simpler${RDQUO}, and ${LDQUO}more effective${RDQUO} than before.`,
      "three-item",
    ],
    [
      "G4c-1 four flat sentences",
      "We saw the plan work. You have the funds now. Your future looks fine. The money will last.",
      "same length",
    ],
    [
      "G4c-2 metronomic prose behind a heading",
      "## Your plan\n\nWe saw the plan work. You have the funds now. Your future looks fine. The money will last.",
      "same length",
    ],
    [
      "G4c-3 metronomic bullets, which whole-document splitting reads as one sentence",
      "- The plan carries your spending through retirement\n- The accounts you hold today grow enough\n- The tax you pay stays inside the band\n- The money remaining leaves a legacy",
      "same length",
    ],
    [
      "G4c-4 long sentences in a tight band, which a fixed standard deviation misses",
      "The plan holds your spending for the whole of retirement. Your accounts keep growing for another decade after that. The tax you pay lands inside the expected band. What remains at the end covers the legacy.",
      "same length",
    ],
    [
      "G4c-5 metronomic long sentences",
      "The plan carries your spending through the whole of retirement without any trouble at all here. The accounts you hold today grow enough to cover every year of that spending easily. The tax you pay across those years stays inside the band we would expect to see. The money that remains at the end is enough to leave the legacy you want.",
      "same length",
    ],
    [
      "G4c-6 a paragraph of identical sentences",
      "Your retirement plan demonstrates a strong likelihood of success across the modelled scenarios. The projected assets remain sufficient to cover your annual spending needs throughout retirement. Taxes represent a meaningful consideration in the middle years of the projection period. The remaining balance at the end supports the legacy goals you have described.",
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

// The must-PASS corpus, in full, and the other side of the constraint. A gate
// that rejects plain, correct prose burns the chapter's single retry on a note
// the model cannot act on, so these are as load-bearing as the rejections.
describe("validateVoice — prose it must not touch", () => {
  const accepted: Array<[string, string]> = [
    [
      "the brief's human sample",
      "Your plan holds up. We looked hard at the years right after you stop working, because that is where a plan like yours usually strains, and it came through fine. Nothing here needs fixing today.",
    ],
    [
      "a 'your plan in one page' chapter",
      `Your plan works. The money lasts through both of your lifetimes with room to spare, and the years right after you stop working ${EMDASH} the stretch that breaks most plans ${EMDASH} hold up under a bad market.\n\nThere is one thing worth watching. Taxes climb sharply in the middle of the next decade. We have time to deal with it.`,
    ],
    [
      "a 'what you have' chapter",
      "You have built more than you think. Most of it sits in accounts you cannot touch without tax, which is the constraint we work around for the rest of this report.\n\nThe house is paid off. That matters more than the balance on any statement.",
    ],
    // The app's own shipped retirement narrative, both as it is written (with
    // em-dashes) and one word per sentence shorter. The second is the LOWEST
    // relative spread the gate accepts anywhere — it is what fixes the
    // threshold, so it must be pinned rather than measured once in a report.
    [
      "the app's own narrative prose, as shipped",
      `The plan has 91% plan confidence, ending with about $2.1M in liquid assets. Projected spending exceeds available funding by $400K over retirement ${EMDASH} a shortfall the plan does not currently cover. Social Security is the largest funding source, covering 38% of lifetime retirement spending. Roth assets make up 12% of the retirement-year portfolio ${EMDASH} a tax-free reserve for later-life or legacy needs.`,
    ],
    [
      "the app's own narrative prose, at the threshold",
      "The plan has 91% plan confidence, ending with about $2.1M in liquid assets. Projected spending exceeds available funding by $400K over retirement, a shortfall the plan does not currently cover. Social Security is the largest funding source, covering 38% of lifetime retirement spending. Roth assets make up 12% of the retirement-year portfolio, a tax-free reserve for later-life or legacy needs.",
    ],
    [
      "the app's own tax narrative",
      `Over the plan, total taxes are projected at $1.4M ${EMDASH} a 18.2% lifetime effective rate. The plan converts $600K to Roth across 6 years, front-loading tax to build tax-free assets. Income triggers IRMAA Medicare surcharges in 4 years, totaling $18K.`,
    ],
    [
      "a bulleted chapter",
      "## What you have\n\n- Your cash and savings, about $40K\n- The retirement accounts, which carry most of the balance\n- The house, now paid off\n\nYour money lasts. That is the headline, and it is the only number that really matters here.",
    ],
    [
      "a list of holdings behind a preposition, which enumerates rather than flourishes",
      "Your money sits in cash, bonds, and stocks. None of that changes this year.",
    ],
    [
      "a list of accounts",
      "You hold three accounts we care about: your IRA, your 401(k), and your brokerage. Together they carry most of the plan.",
    ],
    ["a list of years", "In 2031, 2032, and 2033 the plan draws harder on the taxable account than it does anywhere else."],
    ["a list of names", "Anna, Ben, and Chloe are each named as beneficiaries. Nothing there needs changing."],
    [
      "bare 'overall' is ordinary financial English",
      "Your overall confidence sits at 91%. That is the number to hold on to when a bad quarter rattles you, because it already assumes several of them.",
    ],
    // "Overall" opening a sentence is not automatically the discourse marker:
    // as an adjective it takes the noun it modifies straight after it.
    [
      "'Overall' as an adjective, opening a sentence",
      "Overall spending drops to $80K a year once the mortgage clears. Nothing else in the plan moves, and you do not need to do anything about it today.",
    ],
    [
      "'Overall' as an adjective, opening a bullet",
      "- Overall spending drops to $80K a year once the mortgage clears\n- The rest of the plan is unchanged\n- Nothing needs doing today, and nothing needs doing next year either",
    ],
    [
      "one hedge is how a careful advisor writes",
      "The plan may not last if you spend at last year's pace. We modelled that, and the gap shows up in your late seventies.",
    ],
    // A modal plus an adverb is only a stacked hedge when the adverb adds
    // nothing. These four say something the modal does not, and every one of
    // them is prose an advisor would sign.
    [
      "'would likely' says more than 'would'",
      "Your taxes would likely rise in the year you convert. We can plan around that, and the plan you are reading already assumes you do.",
    ],
    [
      "'can typically' says more than 'can'",
      "You can typically withdraw about 4% a year without running short. Your own number is a little higher than that, which is the whole point of the exercise.",
    ],
    [
      "'could probably' says more than 'could'",
      "A bad decade could probably still be absorbed by the plan. We tested it against the worst stretch on record, and the money held.",
    ],
    [
      "'would generally' says more than 'would'",
      "Social Security would generally cover about a third of your spending. The rest comes from the accounts you have spent thirty years building.",
    ],
    [
      "two sentences of equal length is a coincidence, not a rhythm",
      "The plan may not last if you spend at that pace. We modelled it, and the gap shows in your late seventies.",
    ],
    ["three deliberately short sentences", "You are fine. The money lasts. Nothing here needs fixing."],
    ["three short sentences that vary", "You are fine. The money lasts through both your lifetimes. Nothing to fix."],
    [
      "a five-sentence chapter",
      "Your plan works. We ran it against a bad decade and it still works, which is the part most people want to know first. Taxes are the one pressure point. They climb in the middle of the next decade. There is time.",
    ],
    [
      "'note' and 'summarize' as ordinary words",
      "One note on the tax figures. They summarize a decade of returns, so treat any single year lightly.",
    ],
    [
      "'conclusion' and 'summarize' as ordinary words",
      "We reached that conclusion the slow way. Let me summarize the rest in person, because every scenario we ran ended with money left over.",
    ],
    ["a two-sentence chapter", "You are fine. The money outlasts you both by a wide margin, even in the bad runs."],
  ];

  for (const [name, markdown] of accepted) {
    it(`passes ${name}`, () => {
      expect(validateVoice(markdown, [])).toEqual([]);
    });
  }
});
