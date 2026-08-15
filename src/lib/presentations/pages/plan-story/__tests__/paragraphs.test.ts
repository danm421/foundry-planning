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
    expect(splitParagraphs("**bold and *italic* together**")).toEqual(["bold and italic together"]);
    // A length-3 closing run must be able to close against TWO different
    // openers in turn (1 character against the `*` opener, then its
    // remaining 2 against the `**` opener) — this is delimiter-run
    // splitting, covered in depth below.
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
  // CommonMark's flanking rule has a punctuation clause: a `*` next to
  // punctuation can open or close ONLY if the character on the OTHER side of
  // it is a boundary (whitespace, punctuation, or the edge of the line). A
  // footnote mark right before a comma or semicolon is preceded by a plain
  // digit — not a boundary — so it fails on the open side and the pair never
  // forms.
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

describe("splitParagraphs — a disqualified asterisk does not disable a later real pair", () => {
  // A regex-and-reject approach (the previous shape of this module) matched
  // and consumed a whole span before deciding whether it was genuine, so
  // rejecting a disqualified opener threw away every real pair it happened
  // to sit in front of on the same line. The scanner in paragraphs.ts fixes
  // this by classifying open/close ability BEFORE pairing, so a
  // disqualified run simply never gets pushed or popped and can't disturb
  // anything else. These four are measured repros of that defect, kept as
  // permanent regressions.
  it("does not suppress a later bold span when an earlier asterisk can't open", () => {
    expect(splitParagraphs("Withholding is 22%*, and it is **very significant**.")).toEqual([
      "Withholding is 22%*, and it is very significant.",
    ]);
  });

  it("does not suppress a later bold span when an earlier footnote asterisk can't open", () => {
    expect(
      splitParagraphs("We project $2.1M by 2045*, which assumes **a 6% return** and no plan changes."),
    ).toEqual(["We project $2.1M by 2045*, which assumes a 6% return and no plan changes."]);
  });

  it("does not suppress a later italic span when an earlier footnote asterisk can't open", () => {
    expect(splitParagraphs("It is *great*, the total is $5*, and it is also *wonderful*.")).toEqual([
      "It is great, the total is $5*, and it is also wonderful.",
    ]);
  });

  it("minimal repro: a disqualified asterisk followed by a real pair", () => {
    expect(splitParagraphs("x*,y *z* w")).toEqual(["x*,y z w"]);
  });
});

describe("splitParagraphs — delimiter-run splitting (a run of 3+ closes across multiple openers)", () => {
  // Treating "*" and "**" as fixed, non-splittable tokens (an earlier shape
  // of this scan) left a length-3 run — "***" — unable to close against
  // EITHER a "*" or a "**" opener, so it printed literally. CommonMark lets
  // one physical run supply characters to more than one pairing. Measured
  // against the pre-task implementation and fix-round-1 (both agree, via
  // different mechanisms, since neither treated "*"/"**" as fixed tokens):
  it.each([
    ["***bold and italic***", "bold and italic"],
    ["___text___", "text"],
    ["***Important:*** review annually.", "Important: review annually."],
  ])("closes a length-3 run against a length-3 opener in one match: %s", (input, expected) => {
    expect(splitParagraphs(input)).toEqual([expected]);
  });

  it("closes a length-3 run against two different openers in turn", () => {
    // 1 character of the trailing "***" closes the "*" opener (wrapping
    // "significant"); the remaining 2 characters close the "**" opener
    // (wrapping "really *significant*", already resolved) — both openers
    // end up fully consumed, so every delimiter on the line disappears.
    expect(splitParagraphs("**really *significant*** growth")).toEqual(["really significant growth"]);
  });

  it("does not let a run cross between DIFFERENT delimiter characters", () => {
    // Splitting only ever happens within runs of the SAME character. A `*`
    // closer must not be able to reach past a `_` sitting closer on the
    // stack and consume it — CommonMark rule 9 requires the same character
    // on both ends of a pairing. If this ever regressed, the `*` before "c"
    // would incorrectly pair with the `_` before "b" instead of staying
    // literal, and the output would lose the mid-line "*".
    expect(splitParagraphs("*a _b* c_")).toEqual(["*a b* c"]);
  });
});

describe("splitParagraphs — code spans", () => {
  it("resolves a double-backtick span in one pass, without the old fixed-point loop", () => {
    // The old fixed-point loop happened to fix this by re-running a
    // single-backtick regex three times ("``a``" → "`a`" → "a"). Matching
    // equal-length backtick runs directly gets there in one pass instead.
    expect(splitParagraphs("``a``")).toEqual(["a"]);
  });

  it("lets a longer delimiter run wrap content that itself contains a shorter backtick run", () => {
    // The `` ` `` in the middle survives as literal CODE CONTENT — this is
    // the actual CommonMark mechanism for writing a code span that itself
    // needs to display a literal backtick.
    expect(splitParagraphs("``word`word``")).toEqual(["word`word"]);
  });

  it("does not treat a mismatched-length backtick pair as a code span", () => {
    // Two backticks, then one — CommonMark requires the CLOSING run to be
    // the same length as the opening one; with none available, nothing
    // strips and the line stays fully literal.
    expect(splitParagraphs("``word````")).toEqual(["``word````"]);
  });
});

describe("splitParagraphs — a line that is nothing but backtick(s) drops whole", () => {
  // The identical class to the `*`/`_`-spelled rule above, introduced the
  // same way: while the strip was a blanket delete, a lone backtick line
  // vanished as a side effect; once the strip became syntax-aware, an
  // unmatched backtick — which has no legitimate meaning in financial
  // narrative prose, unlike `*`/`_` — started printing literally instead.
  it.each([
    ["`", []],
    ["```", []],
  ])("drops %s entirely", (input, expected) => {
    expect(splitParagraphs(input)).toEqual(expected);
  });

  it("does not touch a backtick that is genuinely part of a sentence", () => {
    expect(splitParagraphs("It costs `$5 more")).toEqual(["It costs `$5 more"]);
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

describe("splitParagraphs — a *-or-_-spelled horizontal rule drops whole, like the -spelled one", () => {
  // RULE_LINE_RE only ever checked for a literal `-`. While the strip was a
  // blanket [*_`] delete, a "***"/"___" line still vanished as a side effect
  // — reduced to the empty string, then dropped by .filter(Boolean) — so the
  // gap didn't show. Once the strip became syntax-aware (this task), an
  // UNMATCHED delimiter run prints literally instead of vanishing, and a
  // model-written rule started reaching the page as literal asterisks.
  // Measured against the pre-task implementation (31518ab2f): it produced
  // [] for a standalone "***" paragraph.
  it.each([
    ["***", []],
    ["___", []],
    ["* * *", []], // CommonMark allows spaces between the delimiter characters
    ["_ _ _", []],
  ])("drops %s entirely", (input, expected) => {
    expect(splitParagraphs(input)).toEqual(expected);
  });

  it("drops the rule but keeps the paragraphs around it", () => {
    expect(splitParagraphs("Here is the plan.\n\n***\n\nAnd here is more.")).toEqual([
      "Here is the plan.",
      "And here is more.",
    ]);
  });

  it("does not treat two stars alone as a rule — CommonMark requires three or more", () => {
    // Not a valid emphasis pair either (nothing to pair with), so it stays
    // literal — same treatment as any other unmatched delimiter run.
    expect(splitParagraphs("**")).toEqual(["**"]);
  });

  it("does not mistake a real single-word italic spanning the whole line for a rule", () => {
    expect(splitParagraphs("*text*")).toEqual(["text"]);
  });
});
