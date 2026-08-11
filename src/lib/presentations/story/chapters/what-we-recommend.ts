import type { ChangeArea } from "@/lib/presentations/pages/scenario-changes/types";
import type { StoryStrategy, StoryContext } from "../types";
import type { Fact } from "../facts";
import { validateFacts } from "../validate/facts";

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
  return validateFacts(text, facts).length === 0;
}

/** The part of the plan an area touches, in the words a client uses for it. */
const AREA_PHRASE: Record<ChangeArea, string> = {
  "Plan & Assumptions": "the assumptions behind your plan",
  Income: "your income",
  Expenses: "your spending",
  Savings: "what you're saving",
  Assets: "your accounts",
  Liabilities: "what you owe",
  Estate: "your estate plan",
  Taxes: "your taxes",
};

/**
 * A detail is a clause here, not a sentence. Half of them arrive already
 * punctuated — every `whyAdd`/`whyRemove`/`whyEdit` string in the describers'
 * spec table ends in a period, and a single-field edit puts `whyEdit` straight
 * into `detail[0]` — so appending one blind prints "Adjusts this gift.." to the
 * client. Trailing punctuation comes off, and this function adds the only stop.
 */
function asClause(detail: string): string {
  return detail.replace(/[\s.;:,]+$/u, "");
}

function describe(strategy: StoryStrategy, facts: Fact[]): string {
  const first = strategy.rows[0];
  if (!first) return `${strategy.name}.`;

  const detail = first.detail[0];
  if (detail && grounded(detail, facts)) return `${strategy.name} — ${asClause(detail)}.`;

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
  return ctx.strategies.map((s) => describe(s, ctx.facts));
}
