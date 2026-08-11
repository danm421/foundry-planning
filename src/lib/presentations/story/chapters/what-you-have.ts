import { factDisplay, type StoryContext } from "../types";

export function narrateWhatYouHave(ctx: StoryContext): string[] {
  const assets = factDisplay(ctx, "today.assets");
  const debts = factDisplay(ctx, "today.debts");
  const net = factDisplay(ctx, "today.netWorth");
  const lines: string[] = [];

  if (assets && debts && net) {
    lines.push(`You own ${assets} and owe ${debts}. The difference — ${net} — is what the plan works with.`);
  } else if (net) {
    lines.push(`Your net worth today is ${net}.`);
  }

  lines.push("Not all of it is available to spend. Your home and anything held for someone else sit outside the money the plan draws on.");
  return lines;
}
