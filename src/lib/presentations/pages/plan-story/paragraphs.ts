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

/** A table's delimiter row (`|---|---|`) and a `-`-spelled horizontal rule a
 *  model writes between sections. Neither carries a word, so both are
 *  dropped whole. */
const RULE_LINE_RE = /^[\s|:-]*-[\s|:-]*$/u;

/** The other two spellings CommonMark allows for a horizontal rule: three or
 *  more of the SAME character, `*` or `_`, each optionally followed by
 *  whitespace. `RULE_LINE_RE` above only ever checked for a literal `-` —
 *  when this module's strip was a blanket `[*_`]` delete, a `***`/`___` line
 *  still vanished as a side effect (reduced to the empty string, then
 *  dropped by `.filter(Boolean)`); once the strip became syntax-aware, an
 *  UNMATCHED delimiter run prints literally instead of vanishing, and this
 *  gap started reaching the page. Measured: the pre-task implementation
 *  (`31518ab2f`) produced `[]` for a standalone `"***"` paragraph; the
 *  syntax-aware strip alone produced `["***"]` — a lone `***` printing on a
 *  client PDF. This closes that gap without loosening `RULE_LINE_RE` itself,
 *  which also has to stay permissive enough to catch a table's own
 *  delimiter row (pipes and alignment colons `*`/`_` never appear in). */
const STAR_OR_UNDERSCORE_RULE_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:_\s*){3,})$/u;

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
    .filter((line) => !RULE_LINE_RE.test(line) && !STAR_OR_UNDERSCORE_RULE_RE.test(line))
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

// `**bold**`, `*em*`, `_em_`, `` `code` `` — matched pairs only, so an
// advisor's own footnote asterisk or an identifier's underscores survive
// unless they're genuinely paired markdown.
//
// Implemented as a small SCAN below, not a single regex-with-backreference —
// that was tried and measurably broke. A regex's lazy `.+?` doesn't stop at
// the nearest `*`; when the nearest candidate fails CommonMark's flanking
// rules, the engine is forced to extend PAST it, consuming it as literal
// content, until it reaches a farther `*` that satisfies the pattern
// structurally. Rejecting the resulting span after the fact (in a
// `.replace()` callback) throws away everything genuine it swallowed on the
// way — measured: `"It is *great*, the total is $5*, and it is also
// *wonderful*."` lost "wonderful" entirely, because the disqualified `$5*`
// forced the match to widen past it. CommonMark's own algorithm avoids this
// by classifying each delimiter run's ability to open/close FIRST (the
// flanking rules below), then pairing runs with a stack — a disqualified run
// simply never gets pushed or popped, so it can't disturb anything else.

/** CommonMark's "Unicode punctuation character": ASCII punctuation plus the
 *  Unicode general categories P* and S* — the same union the spec's own
 *  definition uses (so `$`, `%` and `+` count, not just `.,;`). */
const PUNCTUATION_RE = /[\p{P}\p{S}]/u;
const WHITESPACE_RE = /\s/u;

/** A "good" neighbour for the punctuation clause below: the edge of the
 *  line, whitespace, or punctuation itself. `undefined` stands for the edge
 *  of the line — `stripMarkdown` already processes one line at a time, so
 *  there is no character past either end to read. */
function isBoundaryLike(neighbor: string | undefined): boolean {
  return neighbor === undefined || WHITESPACE_RE.test(neighbor) || PUNCTUATION_RE.test(neighbor);
}

/** CommonMark's left/right-flanking rules. `undefined` (edge of line) counts
 *  as whitespace for the "not preceded/followed by whitespace" clause —
 *  there is no character there to BE non-whitespace — but still counts as a
 *  boundary for the punctuation clause, which explicitly allows "or the
 *  edge of the line". */
function isLeftFlanking(prev: string | undefined, next: string | undefined): boolean {
  if (next === undefined || WHITESPACE_RE.test(next)) return false;
  return !PUNCTUATION_RE.test(next) || isBoundaryLike(prev);
}
function isRightFlanking(prev: string | undefined, next: string | undefined): boolean {
  if (prev === undefined || WHITESPACE_RE.test(prev)) return false;
  return !PUNCTUATION_RE.test(prev) || isBoundaryLike(next);
}

type DelimType = "*" | "**" | "_" | "__";

interface DelimRun {
  type: DelimType;
  start: number;
  end: number;
  canOpen: boolean;
  canClose: boolean;
}

/** Longest run first (`**` before `*`) at each position, same preference the
 *  old regex alternation used. A run of 3+ of the same character — not a
 *  target of any test here, and CommonMark's own handling of it is a further
 *  layer of complexity this module doesn't need — falls out as a 2-run
 *  immediately followed by 1-runs. */
const DELIM_TOKEN_RE = /\*\*|\*|__|_/gu;

function scanDelimiterRuns(line: string): DelimRun[] {
  const runs: DelimRun[] = [];
  DELIM_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DELIM_TOKEN_RE.exec(line))) {
    const type = match[0] as DelimType;
    const start = match.index;
    const end = start + match[0].length;
    const prev = start > 0 ? line[start - 1] : undefined;
    const next = end < line.length ? line[end] : undefined;
    const left = isLeftFlanking(prev, next);
    const right = isRightFlanking(prev, next);
    // `_`/`__` additionally can't open/close INTRAWORD (CommonMark's extra
    // rule for underscores): flanking on BOTH sides at once only counts as a
    // valid opener/closer when the OTHER side is punctuation — which is what
    // stops `plan_review_2026` from reading as a pair (flanking on both
    // sides, neither side punctuation) while still letting `__init__`
    // (flanking on only one side each — start-of-line / space) strip as
    // real bold. `*`/`**` carry no such restriction.
    const underscoreGuard = type === "_" || type === "__";
    runs.push({
      type,
      start,
      end,
      canOpen: underscoreGuard ? left && (!right || (prev !== undefined && PUNCTUATION_RE.test(prev))) : left,
      canClose: underscoreGuard ? right && (!left || (next !== undefined && PUNCTUATION_RE.test(next))) : right,
    });
  }
  return runs;
}

/** A single backtick pair — matched pair only, non-whitespace-padded
 *  content, same shape as the delimiter runs below but without their
 *  flanking rules (code spans aren't emphasis). Runs first, so a code
 *  span's own `*`/`_` characters are gone before the delimiter scan ever
 *  sees them — except for one pre-existing, ledgered gap this task doesn't
 *  close: that scan still re-examines whatever the code span's CONTENT
 *  contained, the same as it always has. */
const CODE_SPAN_RE = /`(?=\S)(.+?)(?<=\S)`/gu;

/** Delimiter runs are paired with a stack: a closer looks for the nearest
 *  still-open run of the SAME type (strict nesting only — this module has
 *  never needed the crossing patterns full CommonMark allows, and chapter
 *  prose doesn't produce them). Stripping a matched pair is then just
 *  deleting its two delimiter runs; nesting needs no second pass, because an
 *  inner pair's runs are already marked for deletion by the time the outer
 *  pair's content is read out. */
function stripEmphasis(line: string): string {
  const withoutCode = line.replace(CODE_SPAN_RE, (_match, content: string) => content);
  const runs = scanDelimiterRuns(withoutCode);
  const stack: DelimRun[] = [];
  const toDelete = new Set<DelimRun>();
  for (const run of runs) {
    const opener = stack[stack.length - 1];
    if (run.canClose && opener !== undefined && opener.type === run.type) {
      stack.pop();
      toDelete.add(opener);
      toDelete.add(run);
    } else if (run.canOpen) {
      stack.push(run);
    }
  }
  let out = "";
  let cursor = 0;
  for (const run of runs) {
    if (!toDelete.has(run)) continue;
    out += withoutCode.slice(cursor, run.start);
    cursor = run.end;
  }
  out += withoutCode.slice(cursor);
  return out;
}

/** Blank lines separate paragraphs; a single newline is a line break inside one. */
export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/u).map(stripMarkdown).filter(Boolean);
}
