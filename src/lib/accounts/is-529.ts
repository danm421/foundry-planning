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
