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
 * The balance sheet can arrive partial: the two sides and the net are three
 * separate facts, and a total can fail while its components succeed. All eight
 * combinations are handled, and every figure the pack holds is stated — an
 * earlier version tested `net` before the single sides, so a pack holding
 * assets AND net printed the net alone and dropped a figure it had.
 *
 * Branch on the SIDES first, and treat the net as an addition to whatever they
 * produced; that ordering is what makes the coverage total rather than a chain
 * of cases someone has to check by hand.
 */
function opening(assets: string | null, debts: string | null, net: string | null): string | null {
  if (assets && debts) {
    return net
      ? `You own ${assets} and owe ${debts}. The difference — ${net} — is what the plan works with.`
      : `You own ${assets} and owe ${debts}.`;
  }

  const side = assets ? `You own ${assets}` : debts ? `You owe ${debts}` : null;
  if (side) return net ? `${side}, and your net worth today is ${net}.` : `${side}.`;

  return net ? `Your net worth today is ${net}.` : null;
}

export function narrateWhatYouHave(ctx: StoryContext): string[] {
  const assets = factDisplay(ctx, "today.assets");
  const debts = factDisplay(ctx, "today.debts");
  const net = factDisplay(ctx, "today.netWorth");

  const line = opening(assets, debts, net);
  if (!line) return [NOTHING_TOTALLED];

  // The caveat qualifies what you OWN, so it can only follow a sentence that put
  // a figure on it. A debts-only pack states a liability and nothing else, and
  // "not all of what you own" would arrive with no ownership figure behind it.
  return assets || net ? [line, NOT_ALL_SPENDABLE] : [line];
}
