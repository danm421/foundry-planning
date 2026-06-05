export interface PropertyRef {
  id: string;
  name: string;
}

// Words that describe the liability instrument rather than the property.
const LIABILITY_TYPE_WORDS = new Set([
  "mortgage", "loan", "heloc", "line", "credit", "equity", "note", "balance",
]);
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "to", "for", "on"]);

function tokenize(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

/**
 * Match a mortgage / loan liability to a real-estate account by name-token
 * overlap. Liability-instrument words ("mortgage", "loan", …) are dropped from
 * the liability tokens before scoring, so "Mortgage - Austin Home" scores on
 * {austin, home}. The property with the strictly-highest overlap (>= 1) wins;
 * zero overlap or a tie returns null (left unlinked for the advisor).
 */
export function matchMortgageToProperty(
  liabilityName: string,
  properties: PropertyRef[],
): string | null {
  const liabTokens = new Set(
    [...tokenize(liabilityName)].filter((t) => !LIABILITY_TYPE_WORDS.has(t)),
  );
  if (liabTokens.size === 0) return null;

  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const p of properties) {
    let score = 0;
    for (const t of tokenize(p.name)) if (liabTokens.has(t)) score += 1;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: p.id, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.id : null;
}
