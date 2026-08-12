import type { ChangeArea } from "@/lib/presentations/pages/scenario-changes/types";
import { factsForChapter, type StoryStrategy, type StoryContext } from "../types";
import { factDisplaySet, hasAccountingNegative, type Fact } from "../facts";
import { extractFigures, validateFacts } from "../validate/facts";

/**
 * A `ChangeRow` is built for the Scenario Changes TABLE, by a formatter this
 * module does not own: `detail`, `before` and `after` are full of figures, in
 * that table's house style rather than this document's.
 *
 *   "$50k/yr from Traditional IRA → Roth IRA · 2028–2033"   roth_conversion add
 *   "Annual amount: $20k → $25k"                            savings_rule edit
 *   "$300k · 4.50% · $1.8k/mo"                              liability add
 *   before "$100k" / after "$150k"                          expense edit
 *
 * (Every one of those is pinned by a test under
 * `pages/scenario-changes/describe/__tests__/`.)
 *
 * Two problems, and the second is the serious one. The table rounds with
 * `compactCurrency` — lowercase "k", a decimal at the thousands scale,
 * parenthesised negatives — where this document rounds with `moneyFact`, so the
 * same dollar prints two ways in one deck. And the amounts themselves are not in
 * the fact pack, which is the premise the whole report rests on: every figure a
 * client reads is one we put there deliberately. So a detail is quoted only when
 * the fact gate would accept it, and otherwise the strategy is described without
 * numbers rather than with borrowed ones.
 *
 * The gate is reused rather than reimplemented on purpose: a private notion of
 * "is this a figure" would drift from the one the LLM chapters are held to, and
 * the drift would show up as a number on a client's page.
 */
function grounded(text: string, facts: Fact[]): boolean {
  if (validateFacts(text, facts).length > 0) return false;
  // …and the gate is not quite enough on its own. Its comparison key folds case,
  // so the table's "$850k" satisfies an "$850K" fact: the VALUE is grounded, the
  // SPELLING is the other module's. Printing it would put both spellings of the
  // same dollar in one deck, which is the inconsistency this file exists to stop.
  // Both checks reuse the gate's own extractor, so what counts as a figure here
  // can never drift from what the LLM chapters are held to.
  const spellings = factDisplaySet(facts);
  return extractFigures(text).every((figure) => spellings.has(figure));
}

/** The part of the plan an area touches, in the words a client uses for it. */
const AREA_PHRASE: Record<ChangeArea, string> = {
  "Plan & Assumptions": "the assumptions behind your plan",
  Income: "your income",
  Expenses: "your spending",
  Savings: "what you're saving",
  // Not "your accounts": the area covers real estate and businesses too.
  Assets: "what you own",
  Liabilities: "what you owe",
  Estate: "your estate plan",
  Taxes: "your taxes",
};

/**
 * A detail is a clause here, not a sentence. Half of them arrive already
 * punctuated — every `whyAdd`/`whyRemove`/`whyEdit` string in the describers'
 * spec table ends in a period, and a single-field edit puts `whyEdit` straight
 * into `detail[0]` — so appending one blind prints "Adjusts this gift.." to the
 * client. Every terminal mark comes off, not just the period: "!", "?", an
 * ellipsis and any of the three dashes double up exactly the same way.
 */
function asClause(detail: string): string {
  return detail.replace(/[\s.;:,!?…—–-]+$/u, "");
}

/**
 * The describers' "no value" marker. `fmtValue`, `label` and `recipients` all
 * return "—" for a null field, so it reaches `detail` as a value rather than as
 * punctuation. Two real paths produce it:
 *
 *   "All remaining assets → —"   describe/kinds/estate.ts, a will with no
 *                                recipients resolved
 *   "—"                          describe/registry.ts, an entity whose only
 *                                segment is an unlabelled type
 *
 * A detail ending in one never names the thing it set out to name, so there is
 * nothing worth quoting: stripping the dash leaves either an empty string or a
 * dangling "All remaining assets →", and neither is an improvement on the
 * generic clause. The leading `[\s→:]` keeps it off hyphenated words.
 */
const UNRESOLVED_TAIL = /(?:^|[\s→:])[—–-]+\s*$/u;

/** The quotable clause inside a detail, or null when there is nothing to quote. */
function usableDetail(detail: string | undefined): string | null {
  if (!detail || UNRESOLVED_TAIL.test(detail)) return null;
  // An accounting-paren negative — "Annual amount: ($50k) → ($20k)" — is a form
  // this document does not write, and grounding cannot catch it: the parens are
  // not part of the token, so a "$50k" quoted legitimately from ANOTHER change
  // grounds this one. Measured, not theorised: with a Roth conversion of $50k/yr
  // and a savings edit of $20k → $25k in the same deck, both tokens are in the
  // pack on their own merits and this clause printed verbatim.
  if (hasAccountingNegative(detail)) return null;
  const clause = asClause(detail);
  return clause.length > 0 ? clause : null;
}

function describe(strategy: StoryStrategy, facts: Fact[]): string {
  const first = strategy.rows[0];
  if (!first) return `${strategy.name}.`;

  // Ground what will actually be printed, not the raw detail it came from.
  const clause = usableDetail(first.detail[0]);
  if (clause && grounded(clause, facts)) return `${strategy.name} — ${clause}.`;

  // `before`/`after` are deliberately not a second chance here: for an add or a
  // remove they are the table's own shorthand ("—", "Added", "In plan"), which
  // reads as nothing at all in prose, and for an edit they carry exactly the
  // figures this branch exists to keep off the page.
  return `${strategy.name} — this changes ${AREA_PHRASE[first.area]}.`;
}

export function narrateWhatWeRecommend(ctx: StoryContext): string[] {
  if (!ctx.hasProposal || ctx.strategies.length === 0) {
    return ["We aren't suggesting changes to the plan this time."];
  }
  // Ground against this chapter's figures, not the whole pack. `generate.ts`
  // already hands over a scoped context, so this is a no-op on that path — but
  // the narrator is also what renders when generation is off, called straight
  // off `CHAPTERS[id].narrate`, and `grounded()` is the check standing between a
  // borrowed figure and a client's page. It may not depend on its caller.
  const facts = factsForChapter(ctx.facts, "whatWeRecommend");
  return ctx.strategies.map((s) => describe(s, facts));
}
