import { factDisplay, type StoryContext } from "../types";

/**
 * Says what the chapter is for without asserting a balance sheet it has no
 * figures for — this is the one branch where nothing is known, and it is the
 * whole chapter when it fires.
 */
const NOTHING_TOTALLED =
  "Your plan starts from what you own, set against what you owe. We don't have those figures to show here.";

/**
 * "Not all of WHAT YOU OWN", never "not all of it". The pronoun had to refer
 * back to whichever figure the opening happened to name, and the opening varies
 * — that dependency is what put a dangling pronoun on the page once already.
 */
const NOT_ALL_SPENDABLE =
  "Not all of what you own is available to spend. Your home and anything held for someone else sit outside the money the plan draws on.";

/**
 * The balance sheet can arrive partial: the two sides and the net are separate
 * facts, and a total can fail while its components succeed. Every figure the
 * pack does hold gets stated — throwing one away silently is worse than a
 * shorter sentence.
 */
function opening(assets: string | null, debts: string | null, net: string | null): string | null {
  if (assets && debts && net) return `You own ${assets} and owe ${debts}. The difference — ${net} — is what the plan works with.`;
  if (assets && debts) return `You own ${assets} and owe ${debts}.`;
  if (net) return `Your net worth today is ${net}.`;
  if (assets) return `You own ${assets}.`;
  if (debts) return `You owe ${debts}.`;
  return null;
}

export function narrateWhatYouHave(ctx: StoryContext): string[] {
  const line = opening(
    factDisplay(ctx, "today.assets"),
    factDisplay(ctx, "today.debts"),
    factDisplay(ctx, "today.netWorth"),
  );
  return line ? [line, NOT_ALL_SPENDABLE] : [NOTHING_TOTALLED];
}
