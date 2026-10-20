import type { ExtractedAccount } from "@/lib/extraction/types";
import { nameSimilarity, valueProximity } from "./match-keys/account";

/**
 * The order the import review's link picker lists a household's existing
 * accounts in for one extracted account — the advisor's likeliest pick first.
 *
 * - Properties are left out unless the extracted row is itself a property: a
 *   brokerage or IRA statement is never the house. The row's current link is
 *   kept whatever it is, so reopening the picker still shows it.
 * - Accounts of the extracted row's own type come first — a taxable statement
 *   lists the taxable accounts, then everything else.
 * - Within each group, the closest balance and the most similar name rise. The
 *   two are added rather than one breaking the other's ties, so a same-named
 *   account whose value moved since the last import still lands near the top.
 *
 * Ordering only, never an exclusion beyond properties: the extractor misreads
 * category often enough that the right account can sit in the "wrong" group.
 */
export function rankAccountCandidates<
  C extends { id: string; name: string; category: string; value: number },
>(
  incoming: Pick<ExtractedAccount, "name" | "category" | "value">,
  existing: C[],
  keepId?: string,
): C[] {
  const hideProperties = incoming.category !== undefined && incoming.category !== "real_estate";
  return existing
    .filter((a) => a.id === keepId || !(hideProperties && a.category === "real_estate"))
    .map((a) => ({
      a,
      sameType: a.category === incoming.category,
      likelihood: nameSimilarity(a.name, incoming.name) + valueProximity(incoming.value, a.value),
    }))
    .sort((x, y) => Number(y.sameType) - Number(x.sameType) || y.likelihood - x.likelihood)
    .map(({ a }) => a);
}
