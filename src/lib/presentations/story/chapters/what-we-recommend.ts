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

/**
 * The clause a change may be described with, or null when there is nothing safe
 * to quote — a detail that never resolved, an accounting-paren negative, or a
 * figure this pack does not hold in this spelling.
 *
 * Exported because the prose above is no longer the only place a `ChangeRow`
 * detail reaches a client. The Plan Story's strategy CARDS print the same field,
 * and the pack's quoted half is admitted (`build-facts.ts#quoteStrategyFigures`)
 * on the explicit understanding that "the same clause is refused again at the
 * point of printing". A second printing point that skipped the refusal would put
 * the changes table's own rounding and case straight onto a client's page — the
 * exact leak this module exists to stop — so both call it.
 *
 * ⚠️ The cards call it on `what` as well as on `detail`, and the argument is the
 * same one: `what` is not the advisor's typing either. A savings rule has no
 * name of its own, so `lib/scenario/describe-change-target.ts` builds one out of
 * the account plus a formatted basis, and `describe/kinds/savings.ts` writes that
 * string into `what`. Nothing about this function is specific to `detail` — it
 * asks whether a string the changes table wrote is safe to print here.
 */
export function quotableDetail(detail: string | undefined, facts: Fact[]): string | null {
  const clause = usableDetail(detail);
  return clause && grounded(clause, facts) ? clause : null;
}

/**
 * Characters and shapes that mean a "strategy name" is not a phrase a client can
 * read — it is the Scenario Changes table's own machine text, or a field an
 * advisor typed for themselves.
 *
 *   ·  the table's segment separator          "Susan - 401k · 10% of salary"
 *   →  its before/after arrow                 "Roth percent: — → 100%"
 *   :  a label/value pair                     "Annual amount: $20k"
 *   —  its no-value marker
 *   (Plan Start) / (Client Retirement)        milestone refs, printed raw
 *
 * A name carrying any of them is not quoted. The AREA PHRASE says the same thing
 * in the client's own words, which is what the suppressed path is for — this
 * chapter is the one the model most often fails to write, and what replaces it
 * has to be publishable on its own.
 *
 * ⚠️ Deliberately NOT a figure check. `grounded()` already covers figures, and a
 * label can be perfectly grounded and still be unreadable ("Reiinvest Assets
 * Aggresive" holds no figure at all). Two different faults, two different tests.
 */
const MACHINE_TEXT = /[·→:]|[—–]\s*$|\((?:Plan Start|Client Retirement)\)/u;

/**
 * A label an advisor typed for a toggle group, quotable on a client's page?
 *
 * Length is the second half of the answer. A "strategy name" of eighty
 * characters is a sentence the changes table joined, not a name — the observed
 * ones run to "Susan - 401k · 10% of salary — Roth percent: — → 100%".
 *
 * Exported because the strategy CARDS print `name` too (`view-model.ts`,
 * `buildPlanStoryData`), a second printing point the same machine text reaches
 * unless it goes through the same refusal.
 */
export function usableName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 48 && !MACHINE_TEXT.test(trimmed);
}

/** "your spending" → "adjusts your spending". One sentence a client can read,
 *  built from the area alone, for a strategy whose own label cannot be shown. */
function describeByArea(strategy: StoryStrategy): string {
  const first = strategy.rows[0];
  return first ? `One change adjusts ${AREA_PHRASE[first.area]}.` : "One change adjusts the plan.";
}

function describe(strategy: StoryStrategy, facts: Fact[]): string {
  const first = strategy.rows[0];
  // The label is refused BEFORE the detail — or the absence of any row — is
  // considered: a strategy with no rows but a machine-text name would otherwise
  // fall through the `!first` branch below and print the name anyway.
  if (!usableName(strategy.name)) return describeByArea(strategy);
  if (!first) return `${strategy.name}.`;

  const clause = quotableDetail(first.detail[0], facts);
  if (clause) return `${strategy.name} — ${clause}.`;

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
