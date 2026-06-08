// Format a couple's household display name for the report cover.
//
// The presentation data model stores the primary as first + last but the spouse
// as a single `spouseName` string — usually just a first name ("Anita"),
// occasionally a full "First Last". From those inputs we produce:
//
//   solo:                       "Frank Doyle"
//   spouse, shared surname:     "Frank & Anita Doyle"
//   spouse, different surname:  "Frank Doyle & Anita Jackson"
//
// A shared surname is assumed when the spouse field carries no surname (the
// common case) or carries the same surname as the primary. When the spouse
// field carries a different surname, both names are kept in full.

/**
 * @param primaryName Full primary name, e.g. "Frank Doyle".
 * @param spouseName  Spouse field — a bare first name or a full name, or null.
 */
export function formatHouseholdName(
  primaryName: string,
  spouseName: string | null | undefined,
): string {
  const primary = primaryName.trim().replace(/\s+/g, " ");
  const spouse = (spouseName ?? "").trim().replace(/\s+/g, " ");
  if (!spouse) return primary;

  const primaryTokens = primary.split(" ");
  const primaryFirst = primaryTokens.slice(0, -1).join(" ");
  const primaryLast = primaryTokens.length > 1 ? primaryTokens[primaryTokens.length - 1] : "";

  const spouseTokens = spouse.split(" ");
  const spouseFirst = spouseTokens.length > 1 ? spouseTokens.slice(0, -1).join(" ") : spouse;
  const spouseLast = spouseTokens.length > 1 ? spouseTokens[spouseTokens.length - 1] : "";

  const sharesSurname =
    spouseLast === "" ||
    (primaryLast !== "" && spouseLast.toLowerCase() === primaryLast.toLowerCase());

  // Fold the shared surname onto the end ("Frank & Anita Doyle"). Requires both
  // a primary first name and a surname to fold; otherwise fall through to the
  // full join so we never drop a token.
  if (sharesSurname && primaryFirst && primaryLast) {
    return `${primaryFirst} & ${spouseFirst} ${primaryLast}`;
  }

  // Distinct surnames (or too little structure to fold): keep both in full.
  return `${primary} & ${spouse}`;
}
