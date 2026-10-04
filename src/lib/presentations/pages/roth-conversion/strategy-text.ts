// One plain sentence per Roth conversion, written from its settings — the
// "what is the strategy" block a client reads first.

import type { Account, RothConversion } from "@/engine/types";
import { exactCurrency, percentLabel } from "@/lib/presentations/format";

interface Context {
  accounts: Account[];
  /** The years the conversion ACTUALLY converted something in the projection.
   *  Its own start/end can run past the plan or past an emptied account, and a
   *  client should read the years that happen, not the ones that were asked for. */
  firstYear: number;
  lastYear: number;
}

export function describeConversion(conv: RothConversion, ctx: Context): string {
  const nameOf = (id: string) => ctx.accounts.find((a) => a.id === id)?.name;
  const sources = joinNames(
    conv.sourceAccountIds.map((id) => nameOf(id)).filter((n): n is string => !!n),
  ) ?? "a pre-tax account";
  const dest = nameOf(conv.destinationAccountId) ?? "a Roth account";
  const single = ctx.firstYear === ctx.lastYear;
  const span = `${ctx.firstYear} through ${ctx.lastYear}`;

  let sentence: string;
  switch (conv.conversionType) {
    case "fixed_amount": {
      const amount = exactCurrency(conv.fixedAmount);
      sentence = single
        ? `Convert ${amount} from ${sources} to ${dest} in ${ctx.firstYear}`
        : `Convert ${amount} a year from ${sources} to ${dest}, ${span}`;
      if (!single && conv.indexingRate > 0) {
        sentence += `, increasing ${percentLabel(conv.indexingRate)} a year`;
      }
      break;
    }
    case "full_account":
      sentence = `Convert the full balance of ${sources} to ${dest} in ${ctx.firstYear}`;
      break;
    case "deplete_over_period":
      sentence = single
        ? `Convert the full balance of ${sources} to ${dest} in ${ctx.firstYear}`
        : `Spread the conversion of ${sources} to ${dest} across ${span}, so it is fully converted by ${ctx.lastYear}`;
      break;
    case "fill_up_bracket": {
      const bracket =
        conv.fillUpBracket != null ? `the ${percentLabel(conv.fillUpBracket)} tax bracket` : "the current tax bracket";
      sentence = single
        ? `In ${ctx.firstYear}, convert just enough from ${sources} to ${dest} to fill ${bracket}`
        : `Each year from ${span}, convert just enough from ${sources} to ${dest} to fill ${bracket}`;
      break;
    }
  }

  if (conv.irmaaCapTier === 0) sentence += ", without triggering a Medicare surcharge";
  else if (conv.irmaaCapTier != null) {
    sentence += `, keeping any Medicare surcharge at level ${conv.irmaaCapTier} or below`;
  }
  return `${sentence}.`;
}

/** House style is the serial comma: "A and B", "A, B, and C". */
function joinNames(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
