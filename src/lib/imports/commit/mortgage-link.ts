export interface PropertyRef {
  id: string;
  name: string;
  /** `accounts.property_address`, when the row has one. */
  propertyAddress?: string | null;
}

/** Normalize an address for equality: case, punctuation and runs of space. */
function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when two addresses name the same place, ignoring case and punctuation. */
export function propertyAddressMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeAddress(a) === normalizeAddress(b);
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
 * Match a mortgage / loan liability to a real-estate account. One property
 * whose address equals the secured address wins outright; otherwise (no
 * address, or two properties claiming the same one) it falls to name-token
 * overlap. Liability-instrument words ("mortgage", "loan", …) are dropped
 * from the liability tokens before scoring, so "Mortgage - Austin Home" is
 * scored on {austin, home}. The property with the strictly-highest overlap
 * (>= 1) wins; zero overlap or a tie returns null (left unlinked for the
 * advisor).
 */
export function matchMortgageToProperty(
  liabilityName: string,
  properties: PropertyRef[],
  /**
   * The liability's own `propertyAddress`. An exact address is a fact the
   * document stated; token overlap is a guess. So when both sides carry an
   * address and they agree, that wins outright — and a tie between two
   * same-named properties stops being unresolvable.
   */
  liabilityAddress?: string,
): string | null {
  if (liabilityAddress) {
    const exact = properties.filter((p) =>
      propertyAddressMatches(p.propertyAddress ?? undefined, liabilityAddress),
    );
    if (exact.length === 1) return exact[0].id;
  }

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
