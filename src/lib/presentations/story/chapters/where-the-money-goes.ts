// Chapter 3 — what comes in, what goes out, and which way the difference runs.
//
// The most human page in the report, and the one a client checks against their
// own bank statement — so every figure here is the one the deck's Cash Flow page
// already shows, off the same projection year.
//
// The direction is stated from `raw`, never from a computed and re-formatted
// figure: `display` is rounded for the page, so $320K minus $210K is not
// reliably "$110K" at compact precision, and printing a total the client cannot
// reproduce from the other two is exactly what Gate 1 exists to stop.
import { factDisplay, findFact, type StoryContext } from "../types";

const NOTHING_KNOWN =
  "This is where we'd normally walk through what comes in each year and where it goes. We don't have those figures loaded yet.";

const HEADROOM =
  "More comes in than goes out, and that gap is what builds everything else in this plan.";
const TIGHT =
  "More goes out than comes in right now, so the plan draws on what you've already saved to cover the difference.";

/**
 * Which way the year runs.
 *
 * Compared on `raw` and printed as neither figure. Income has to be known and
 * at least one outflow with it — a direction asserted from one side is not a
 * comparison, and "more comes in than goes out" beside a pack that never held a
 * spending figure is a claim about nothing.
 *
 * Saving counts as money going out, because it is: the three facts are built so
 * that income minus the other two IS the engine's own Net Cash Flow, the line
 * the deck's Cash Flow page draws. Comparing income against spending alone
 * would tell a household saving every spare dollar that it has room to spare.
 */
function direction(ctx: StoryContext): string | null {
  const income = findFact(ctx, "flow.income")?.raw;
  const spending = findFact(ctx, "flow.spending")?.raw;
  const saving = findFact(ctx, "flow.saving")?.raw;
  if (income == null || (spending == null && saving == null)) return null;
  return income >= (spending ?? 0) + (saving ?? 0) ? HEADROOM : TIGHT;
}

export function narrateWhereTheMoneyGoes(ctx: StoryContext): string[] {
  const income = factDisplay(ctx, "flow.income");
  const spending = factDisplay(ctx, "flow.spending");
  const saving = factDisplay(ctx, "flow.saving");

  if (!income && !spending && !saving) return [NOTHING_KNOWN];

  const paragraphs: string[] = [];

  if (income && spending) {
    paragraphs.push(`About ${income} comes in this year. About ${spending} goes back out.`);
  } else if (income) {
    paragraphs.push(`About ${income} comes in this year.`);
  } else if (spending) {
    paragraphs.push(`About ${spending} goes out this year.`);
  }

  if (saving) paragraphs.push(`Of what's left, ${saving} goes into savings and investments.`);

  const verdict = direction(ctx);
  if (verdict) paragraphs.push(verdict);

  return paragraphs;
}
