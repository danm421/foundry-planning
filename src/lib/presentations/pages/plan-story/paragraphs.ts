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
 *
 * The character classes are the ones `validate/facts.ts#normalizeFigures` and
 * `validate/voice.ts#normalize` already fold for the same reason: emphasis is
 * decoration, not spelling.
 */
function stripMarkdown(paragraph: string): string {
  return paragraph
    .split(/\r?\n/u)
    .filter((line) => !RULE_LINE_RE.test(line))
    .map((line) =>
      line
        .replace(/^ {0,3}#{1,6}\s+/u, "") // heading
        .replace(/^\s*\|/u, "") // a table row's outer pipes…
        .replace(/\|\s*$/u, "")
        .replace(/\s*\|\s*/gu, " · ") // …and the separators between its cells
        .replace(/[*_`]/gu, "") // emphasis and code ticks
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** Blank lines separate paragraphs; a single newline is a line break inside one. */
export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/u).map(stripMarkdown).filter(Boolean);
}
