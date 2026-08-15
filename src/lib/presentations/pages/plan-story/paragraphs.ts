// The one spelling of "turn a chapter's stored text into printable paragraphs",
// shared by the PDF's view-model and the advisor's whole-story read-through.
//
// ⚠️ Its own module rather than two exports on `view-model.ts`, because the
// review panel is a `"use client"` component and importing the view-model would
// grow its bundle for a two-line function.
//
// MEASURED, by walking the value-import graph from each entry point rather than
// by reading import lists — and most of what `view-model.ts` pulls turned out to
// be in the panel's bundle already, costing nothing. Before this module existed
// the panel's closure was 25 modules, and `chapters/registry`,
// `chapters/what-we-recommend` and `story/facts` were all three in it, reached
// through the `chapterIgnoresFullLength` import the panel has always held. So of
// the view-model's own imports exactly two are genuinely new to the client:
// `story/glossary` and `plan-story/options-schema`, plus `view-model.ts` itself.
//
// That is a smaller saving than "it drags the narrator in" would suggest, and it
// is the real one. The other half of the argument does not depend on size: a
// module holding nothing but this cannot grow a client-only import by accident,
// where a shared `view-model.ts` export would. Its own closure is ONE module —
// itself. It imports nothing.
//
// It splits and strips, and stops there. The sheet's own budget —
// `MAX_PARAGRAPHS`, `MAX_PARAGRAPHS_WITH_CARDS`, `restatesCard` — stays in the
// view-model beside the page it is about: those decide what one printed sheet
// holds, and the read-through is not paginated.

/** A table's delimiter row (`|---|---|`) and the horizontal rules a model writes
 *  between sections. Neither carries a word, so both are dropped whole. */
const RULE_LINE_RE = /^[\s|:-]*-[\s|:-]*$/u;

/**
 * Markdown syntax, removed before it reaches the page.
 *
 * The system prompt asks the model for "clean Markdown" (chapters/prompts.ts)
 * and `chapter-pdf.tsx` renders each paragraph into a raw react-pdf `<Text>`, so
 * `##`, `**` and a table's pipes print to the client exactly as written. No gate
 * catches this — Gate 2 rejects only a NESTED heading — and this is the only
 * place that also covers the advisor's own `editedText`, which no gate ever sees.
 */
function stripMarkdown(paragraph: string): string {
  return paragraph
    .split(/\r?\n/u)
    .filter((line) => !RULE_LINE_RE.test(line))
    .map((line) => {
      const withoutHeading = line.replace(/^ {0,3}#{1,6}\s+/u, "");
      const withoutPipes = isTableRow(line)
        ? withoutHeading
            .replace(/^\s*\|/u, "") // a table row's outer pipes…
            .replace(/\|\s*$/u, "")
            .replace(/\s*\|\s*/gu, " · ") // …and the separators between its cells
        : withoutHeading;
      return stripEmphasis(withoutPipes).trim();
    })
    .filter(Boolean)
    .join("\n");
}

/** A line is a table ROW when it has a leading pipe, or two or more of them
 *  anywhere. A single mid-sentence pipe is an advisor writing "either | or",
 *  not a table cell. Cost of that rule, deliberately accepted: a genuine
 *  two-column row written WITHOUT its outer pipes (`Year | Amount`) has only
 *  one pipe and survives as prose instead of being flattened. Advisor prose
 *  outranks table detection here. */
function isTableRow(line: string): boolean {
  return /^\s*\|/u.test(line) || (line.match(/\|/gu)?.length ?? 0) >= 2;
}

/** `**bold**`, `*em*`, `_em_`, `` `code` `` — matched pairs only, so an
 *  advisor's own footnote asterisk or an identifier's underscores survive
 *  unless they're genuinely paired markdown. `*`/`**` may sit inside a word
 *  (CommonMark allows intraword `*` emphasis); `_`/`__` may not, so they carry
 *  a boundary guard the star delimiters must NOT have — one alternation
 *  cannot serve both, because a guard tight enough to spare `plan_review_2026`
 *  also has to leave `*really*good` alone. The `(?=\S)`/`(?<=\S)` pair around
 *  each content group is CommonMark's flanking rule's whitespace clause; the
 *  star branch's punctuation clause (a `*` next to punctuation can only open
 *  or close from the OTHER side of a boundary) is checked separately in
 *  `stripEmphasis`, because it needs the character outside the whole match,
 *  which no regex assertion placed inside this pattern can see on both ends
 *  at once. */
const EMPHASIS_RE =
  /(\*\*|\*)(?=\S)(.+?)(?<=\S)\1|(?<![\p{L}\p{N}])(__|_)(?=\S)(.+?)(?<=\S)\3(?![\p{L}\p{N}])|`(?=\S)(.+?)(?<=\S)`/gu;

/** CommonMark's "Unicode punctuation character": ASCII punctuation plus the
 *  Unicode general categories P* and S* — the same union the spec's own
 *  definition uses (so `$`, `%` and `+` count, not just `.,;`). */
const PUNCTUATION_RE = /[\p{P}\p{S}]/u;

/** A "good" neighbour for the punctuation clause below: the edge of the
 *  line, whitespace, or punctuation itself. `undefined` stands for the edge
 *  of the line — `stripMarkdown` already processes one line at a time, so
 *  there is no character past either end to read. */
function isBoundaryLike(neighbor: string | undefined): boolean {
  return neighbor === undefined || /\s/u.test(neighbor) || PUNCTUATION_RE.test(neighbor);
}

/** One pass only unwraps the OUTER pair of a nested span (`**a *b* c**` →
 *  `a *b* c`) — the inner delimiters are consumed as literal text inside the
 *  match, not re-scanned. Re-applying to a fixed point clears the rest; the
 *  10-pass cap is a safety valve, not a real limit — a single line of chapter
 *  prose never nests this deep. */
function stripEmphasis(line: string): string {
  let current = line;
  for (let pass = 0; pass < 10; pass++) {
    const next = current.replace(
      EMPHASIS_RE,
      (
        match: string,
        _starDelim: string | undefined,
        starContent: string | undefined,
        _underDelim: string | undefined,
        underContent: string | undefined,
        codeContent: string | undefined,
        offset: number,
        source: string,
      ) => {
        if (starContent !== undefined) {
          // CommonMark left/right-flanking, punctuation clause: a `*` that
          // opens or closes right next to a punctuation character is only a
          // valid delimiter if the character on the OTHER side of it is a
          // boundary (whitespace, punctuation, or the edge of the line). A
          // footnote mark like "2045*," fails this — the `*` is followed by
          // punctuation (","), but preceded by a plain digit ("5"), so it
          // cannot open. "0.35%*," passes — the `*` is preceded by
          // punctuation ("%"), which is what makes it a real opener there.
          const opens =
            !PUNCTUATION_RE.test(starContent[0]) || isBoundaryLike(source[offset - 1]);
          const closes =
            !PUNCTUATION_RE.test(starContent[starContent.length - 1]) ||
            isBoundaryLike(source[offset + match.length]);
          return opens && closes ? starContent : match;
        }
        return underContent ?? codeContent ?? match;
      },
    );
    if (next === current) return next;
    current = next;
  }
  return current;
}

/** Blank lines separate paragraphs; a single newline is a line break inside one. */
export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/u).map(stripMarkdown).filter(Boolean);
}
