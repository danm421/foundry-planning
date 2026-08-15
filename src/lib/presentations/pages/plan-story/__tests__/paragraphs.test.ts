import { describe, it, expect } from "vitest";
import { splitParagraphs } from "../paragraphs";

// stripMarkdown (via splitParagraphs) has two jobs that pull against each
// other: strip real markdown syntax the model was asked to write, without
// rewriting the advisor's own prose — a footnote asterisk, a `snake_case`
// reference, a literal "either | or" — which no gate ever inspects. One row
// below ("__init__...") needed its expected value corrected against
// CommonMark's actual rules rather than assumed from first read; see that
// test's own comment for why.
describe("splitParagraphs — advisor prose survives", () => {
  it.each([
    ["We looked at $2.1M today*", "We looked at $2.1M today*"],
    ["See plan_review_2026 for the detail.", "See plan_review_2026 for the detail."],
    ["Either one | the other.", "Either one | the other."],
    ["a * b * c", "a * b * c"],
    ["It costs `$5 more", "It costs `$5 more"],
    ["See my_file_name.py for details.", "See my_file_name.py for details."],
    ["FY_2025_2026 budget.", "FY_2025_2026 budget."],
    ["This is important*", "This is important*"],
    ["_leading and trailing_ident", "_leading and trailing_ident"],
    ["Year | Amount", "Year | Amount"], // documented cost of isTableRow: one pipe, no leading pipe, survives as prose
  ])("leaves %s alone", (input, expected) => {
    expect(splitParagraphs(input)).toEqual([expected]);
  });
});

describe("splitParagraphs — markdown syntax still strips", () => {
  it.each([
    ["## What you have", "What you have"],
    ["It is **really** important.", "It is really important."],
    ["| Year | Amount |", "Year · Amount"],
    ["An _em_ word.", "An em word."],
    ["An *em* word.", "An em word."],
    ["It is __really__ important.", "It is really important."],
    ["code `here` ok", "code here ok"],
    ["run `plan_review_2026` now", "run plan_review_2026 now"],
    ["It is *really*good.", "It is reallygood."], // CommonMark permits intraword `*` emphasis
    ["It is *great* and *wonderful*.", "It is great and wonderful."],
    ["**bold** and *italic*.", "bold and italic."],
    ["`.`", "."],
  ])("still strips %s", (input, expected) => {
    expect(splitParagraphs(input)).toEqual([expected]);
  });

  it("unwraps nested emphasis rather than leaving the inner delimiters behind", () => {
    expect(splitParagraphs("**a *b* c**")).toEqual(["a b c"]);
    expect(splitParagraphs("**really *significant*** growth")).toEqual(["really significant growth"]);
  });

  it("does not let emphasis span two paragraphs (or lines) it never opened on", () => {
    // stripMarkdown works one line at a time — a `*` opened on one line and
    // never closed on that line must not reach across the newline to a `*`
    // that belongs to something else.
    expect(splitParagraphs("*starts here\nends nowhere")).toEqual(["*starts here\nends nowhere"]);
  });
});

describe("splitParagraphs — the two rows the brief's own remedy fails", () => {
  // This is F1 from the pre-dispatch check: the brief's prescribed regex
  // `/(\*\*|__|\*|_|`)(?=\S)(.+?)(?<=\S)\1/gu` treats `_` exactly like `*`,
  // so `plan_review_2026` — a matched `_...._` pair by that rule — loses its
  // underscores. CommonMark forbids intraword `_` emphasis for this reason;
  // `_` and `__` need a word-boundary guard that `*` and `**` must not have.
  it("does not treat a snake_case identifier as an underscore-emphasis pair", () => {
    expect(splitParagraphs("See plan_review_2026 for the detail.")).toEqual([
      "See plan_review_2026 for the detail.",
    ]);
  });

  it("still strips real double-underscore bold", () => {
    expect(splitParagraphs("It is __really__ important.")).toEqual(["It is really important."]);
  });

  // Not a bug: a double-underscore run sitting at TRUE word boundaries on
  // both sides (start-of-line / space, not mid-word like `plan_review_2026`)
  // is real CommonMark emphasis — this is the well-known "__init__ renders
  // bold" gotcha. Pinned here as a deliberate, verified choice so it doesn't
  // get "fixed" back by someone assuming all double underscores are safe.
  it("strips a double-underscore identifier sitting at true word boundaries, per CommonMark", () => {
    expect(splitParagraphs("__init__ is a dunder method.")).toEqual(["init is a dunder method."]);
  });
});

describe("splitParagraphs — a footnote asterisk next to punctuation", () => {
  // CommonMark's flanking rule has a punctuation clause the whitespace-only
  // check in EMPHASIS_RE doesn't cover: a `*` next to punctuation can open
  // or close ONLY if the character on the OTHER side of it is a boundary
  // (whitespace, punctuation, or the edge of the line). A footnote mark
  // right before a comma or semicolon is preceded by a plain digit — not a
  // boundary — so it fails on the open side and the pair never forms.
  it.each([
    [
      "We project $2.1M by 2045*, and $3.4M by 2055*.",
      "We project $2.1M by 2045*, and $3.4M by 2055*.",
    ],
    [
      "We looked at $2.1M today*. Also see the note*.",
      "We looked at $2.1M today*. Also see the note*.",
    ],
    ["Retirement at 65*; college at 18*.", "Retirement at 65*; college at 18*."],
  ])("leaves %s alone", (input, expected) => {
    expect(splitParagraphs(input)).toEqual([expected]);
  });

  it("leaves an asterisk followed by a space alone, even with a real pair later on the line", () => {
    expect(splitParagraphs("A * gap and *real* emphasis.")).toEqual(["A * gap and real emphasis."]);
  });

  // The other side of the same clause: a `*` immediately preceded by
  // punctuation (here "%") IS a boundary on that side, so this pair is
  // genuinely flanked and strips like any other emphasis — the rule can't be
  // relaxed to spare this shape without leaving the CommonMark spec.
  it("still strips a genuinely-flanked span even when it sits next to punctuation", () => {
    expect(splitParagraphs("Fees are 0.35%*, net of the platform*.")).toEqual([
      "Fees are 0.35%, net of the platform.",
    ]);
  });
});

describe("splitParagraphs — table rows vs. a literal pipe in prose", () => {
  it("flattens a table row with outer pipes", () => {
    expect(splitParagraphs("| Year | Amount |")).toEqual(["Year · Amount"]);
  });

  it("flattens a table row with two or more interior pipes and no outer pipes", () => {
    expect(splitParagraphs("Year | Amount | Change")).toEqual(["Year · Amount · Change"]);
  });

  it("leaves a single mid-sentence pipe alone — advisor prose, not a table cell", () => {
    expect(splitParagraphs("Either one | the other.")).toEqual(["Either one | the other."]);
  });
});
