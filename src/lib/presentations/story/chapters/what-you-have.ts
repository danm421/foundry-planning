import { factDisplay, type StoryContext } from "../types";

/** The caveat below opens on "Not all of it", so it can only follow a sentence
 *  that named a total. With no balance sheet there is nothing for "it" to refer
 *  to, and the chapter has to say what it is for instead of qualifying a figure
 *  it never printed. */
const NO_BALANCE_SHEET =
  "This is the balance sheet your plan works from — what you own, set against what you owe.";

export function narrateWhatYouHave(ctx: StoryContext): string[] {
  const assets = factDisplay(ctx, "today.assets");
  const debts = factDisplay(ctx, "today.debts");
  const net = factDisplay(ctx, "today.netWorth");

  let opening: string;
  if (assets && debts && net) {
    opening = `You own ${assets} and owe ${debts}. The difference — ${net} — is what the plan works with.`;
  } else if (net) {
    opening = `Your net worth today is ${net}.`;
  } else {
    return [NO_BALANCE_SHEET];
  }

  return [
    opening,
    "Not all of it is available to spend. Your home and anything held for someone else sit outside the money the plan draws on.",
  ];
}
