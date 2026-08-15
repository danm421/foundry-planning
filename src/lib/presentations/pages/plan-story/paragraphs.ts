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
 *  while this module's strip was a blanket `[*_`]` delete, a `***`/`___`
 *  line still vanished as a side effect (each character removed, leaving an
 *  empty string, then dropped by `.filter(Boolean)`); once the strip became
 *  syntax-aware, an UNMATCHED delimiter run prints literally instead of
 *  vanishing, and this gap started reaching the page. This closes that gap
 *  without loosening `RULE_LINE_RE` itself, which also has to stay
 *  permissive enough to catch a table's own delimiter row (pipes and
 *  alignment colons `*`/`_` never appear in). */
const STAR_OR_UNDERSCORE_RULE_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:_\s*){3,})$/u;

/** A line that is nothing but backtick(s) — a stray or malformed code-fence
 *  attempt with no prose value, the backtick equivalent of the rule above.
 *  Unlike `*`/`_`, a bare backtick has no legitimate meaning in financial
 *  narrative prose (it is not a footnote mark, a math sign, or part of an
 *  identifier), so — same as the `*`/`_`-spelled rule — this drops the
 *  WHOLE LINE rather than leaving an unmatched delimiter to print literally.
 *  A backtick embedded in real prose (`` "It costs `$5 more" ``) is
 *  unaffected: that line has other content and never matches this. */
const BACKTICK_ONLY_LINE_RE = /^\s*`+\s*$/u;

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
    .filter(
      (line) =>
        !RULE_LINE_RE.test(line) &&
        !STAR_OR_UNDERSCORE_RULE_RE.test(line) &&
        !BACKTICK_ONLY_LINE_RE.test(line),
    )
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
//
// The stack below also SPLITS a run rather than treating "*" and "**" as two
// unrelated token types: CommonMark lets a delimiter run of length 3 close a
// "**" pair and still have one "*" left over to open or close something
// else — `"***bold and italic***"` needs its whole 3-run to close against
// its whole 3-run opener (one match, all 6 characters), and
// `"**really *significant*** growth"` needs the trailing 3-run to close
// against TWO different openers in turn (1 character against the `*`
// opener, then its remaining 2 against the `**` opener). Treating "*" and
// "**" as fixed, non-splittable tokens (the previous shape of this scan)
// left both of those printing literal asterisks on the page.

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
 *  edge of the line". Computed once per run from its ORIGINAL neighbours;
 *  a run's ability to open/close does not change as it is later split. */
function isLeftFlanking(prev: string | undefined, next: string | undefined): boolean {
  if (next === undefined || WHITESPACE_RE.test(next)) return false;
  return !PUNCTUATION_RE.test(next) || isBoundaryLike(prev);
}
function isRightFlanking(prev: string | undefined, next: string | undefined): boolean {
  if (prev === undefined || WHITESPACE_RE.test(prev)) return false;
  return !PUNCTUATION_RE.test(prev) || isBoundaryLike(next);
}

/** A run's `start`/`end` shrink as it is split across multiple pairings — an
 *  opener is consumed from its END (the side nearest the content it will
 *  wrap, closest-nesting-first) and a closer from its START (same reason,
 *  mirrored) — so `start`/`end` always bound whatever of the run is still
 *  unconsumed and available to pair with something else. `canOpen`/
 *  `canClose` are fixed at scan time and apply to the whole run for its
 *  lifetime, however much of it remains. */
interface DelimRun {
  char: "*" | "_";
  start: number;
  end: number;
  canOpen: boolean;
  canClose: boolean;
}

/** Maximal runs of `*` or `_` — NOT capped at length 2. Splitting a run
 *  across multiple pairings (below) is what makes a fixed cap unnecessary:
 *  a length-3 run is one token here, not "**" plus "*". */
const DELIM_TOKEN_RE = /\*+|_+/gu;

function scanDelimiterRuns(line: string): DelimRun[] {
  const runs: DelimRun[] = [];
  DELIM_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DELIM_TOKEN_RE.exec(line))) {
    const char = match[0][0] as "*" | "_";
    const start = match.index;
    const end = start + match[0].length;
    const prev = start > 0 ? line[start - 1] : undefined;
    const next = end < line.length ? line[end] : undefined;
    const left = isLeftFlanking(prev, next);
    const right = isRightFlanking(prev, next);
    // `_` additionally can't open/close INTRAWORD (CommonMark's extra rule
    // for underscores): flanking on BOTH sides at once only counts as a
    // valid opener/closer when the OTHER side is punctuation — which is what
    // stops `plan_review_2026` from reading as a pair (flanking on both
    // sides, neither side punctuation) while still letting `__init__`
    // (flanking on only one side each — start-of-line / space) strip as
    // real bold. `*` carries no such restriction.
    const underscoreGuard = char === "_";
    runs.push({
      char,
      start,
      end,
      canOpen: underscoreGuard ? left && (!right || (prev !== undefined && PUNCTUATION_RE.test(prev))) : left,
      canClose: underscoreGuard ? right && (!left || (next !== undefined && PUNCTUATION_RE.test(next))) : right,
    });
  }
  return runs;
}

/** CommonMark code spans: a backtick run opens, and the NEXT run of the SAME
 *  length closes it — a different backtick count in between is content, not
 *  a delimiter (the single `` ` `` inside `` ``word`word`` `` survives as
 *  literal code content this way, which is the actual mechanism CommonMark
 *  gives an advisor for writing a code span that itself needs to show a
 *  backtick). Non-whitespace-padded, same as the delimiter runs above, but
 *  without their flanking rules — code spans aren't emphasis.
 *  First-found-length-match wins, and scanning resumes after the closer.
 *
 *  Matching runs by length correctly in one pass replaces what this
 *  module's old fixed-point loop was accidentally doing for nested spans by
 *  brute force: `` ``a`` `` took three passes of a single-backtick regex
 *  (``a`` → `a` → a) to fully resolve; one correct pass gets there directly. */
function stripCodeSpans(line: string): string {
  const runs: { start: number; end: number }[] = [];
  const runRe = /`+/gu;
  let match: RegExpExecArray | null;
  while ((match = runRe.exec(line))) {
    runs.push({ start: match.index, end: match.index + match[0].length });
  }
  if (runs.length < 2) return line;

  const toDelete: [number, number][] = [];
  let i = 0;
  while (i < runs.length - 1) {
    const opener = runs[i];
    const openerLength = opener.end - opener.start;
    const closerIndex = runs.findIndex((run, j) => j > i && run.end - run.start === openerLength);
    if (closerIndex === -1) {
      i++;
      continue;
    }
    const closer = runs[closerIndex];
    const content = line.slice(opener.end, closer.start);
    if (content.length > 0 && !WHITESPACE_RE.test(content[0]) && !WHITESPACE_RE.test(content[content.length - 1])) {
      toDelete.push([opener.start, opener.end], [closer.start, closer.end]);
    }
    i = closerIndex + 1;
  }
  if (toDelete.length === 0) return line;
  return deleteRanges(line, toDelete);
}

function deleteRanges(source: string, ranges: [number, number][]): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [start, end] of sorted) {
    out += source.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  out += source.slice(cursor);
  return out;
}

/** Delimiter runs are paired with a stack: a closer looks for the nearest
 *  still-open run of the SAME character (strict nesting only — this module
 *  has never needed the crossing patterns full CommonMark allows between
 *  DIFFERENT characters, and chapter prose doesn't produce them; `*` and
 *  `_` can never pair with each other). Consuming `min(opener, closer)`
 *  length at each match, shrinking both, and continuing while the closer
 *  still has length left is the split described above. Because this module
 *  only ever deletes matched delimiter characters and keeps content
 *  verbatim, the precise 1-then-2 chunking CommonMark's own reference
 *  algorithm uses to prefer strong over regular emphasis makes no
 *  observable difference here — the total characters consumed between one
 *  opener and one closer is `min(opener length, closer length)` either way,
 *  so one bigger step produces the same deletions as several smaller ones. */
function stripEmphasis(line: string): string {
  const withoutCode = stripCodeSpans(line);
  const runs = scanDelimiterRuns(withoutCode);
  const stack: DelimRun[] = [];
  const toDelete: [number, number][] = [];
  for (const run of runs) {
    if (run.canClose) {
      while (run.start < run.end) {
        const opener = stack[stack.length - 1];
        if (opener === undefined || opener.char !== run.char) break;
        const use = Math.min(opener.end - opener.start, run.end - run.start);
        toDelete.push([opener.end - use, opener.end]);
        opener.end -= use;
        toDelete.push([run.start, run.start + use]);
        run.start += use;
        if (opener.start === opener.end) stack.pop();
      }
    }
    if (run.start < run.end && run.canOpen) stack.push(run);
  }
  return deleteRanges(withoutCode, toDelete);
}

/** Blank lines separate paragraphs; a single newline is a line break inside one. */
export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/u).map(stripMarkdown).filter(Boolean);
}
