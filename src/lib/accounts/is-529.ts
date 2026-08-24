/**
 * Is this row a 529 / education-savings account?
 *
 * Two signals, either of which is decisive. Extraction historically classified
 * 529s as `taxable` + `subType: "529"` because `education_savings` was not in
 * its category union at all — the prompt now routes them correctly, but old
 * payloads persist and the model can still ignore the rule. Anything that
 * treats 529s specially (no RMDs, a designated beneficiary instead of owners)
 * has to honour BOTH signals or it silently misses those rows.
 *
 * Framework-free and DB-free on purpose: the import review step (a client
 * component) and the import commit step (server) both need the same rule.
 */
export function is529Account(row: {
  category?: string | null;
  subType?: string | null;
}): boolean {
  return row.category === "education_savings" || row.subType === "529";
}

/**
 * The inline "you must name a beneficiary" cue, shared by every surface that
 * edits a 529: the account form and the import review row. One constant
 * because they had already drifted into two different sentences saying the
 * same thing, and an advisor meets both in the same afternoon.
 *
 * The API's own 400 for this is deliberately NOT this string — a rejected save
 * surfaces as a toast, where a "Required —" field prefix reads as a fragment,
 * and the server adds "(family member or name)" to say which inputs satisfy it.
 */
export const BENEFICIARY_REQUIRED_MESSAGE =
  "Required — a 529 is attributed to its designated beneficiary.";
