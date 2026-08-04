/**
 * Destination-account name matching, shared by the savings commit module and
 * the import review UI.
 *
 * `commitSavings` resolves a contribution's `destinationAccountName` to an
 * account id by exact name, then by this normalized form. The review step has
 * to predict that same resolution so it can tell the advisor which rows will
 * actually attach — if the two ever disagree, the UI either promises an
 * attachment that gets skipped at commit or flags one that would have worked.
 * Hence one function, imported by both, rather than the rule written twice.
 *
 * Kept free of db/drizzle imports so the client bundle can take it.
 */
export function normalizeAccountName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The account name `destination` would resolve to — exact first, then
 * normalized, mirroring `commitSavings`. Returns undefined when nothing
 * matches, which is precisely the case that commit skips with a warning.
 *
 * Returns the CANONICAL name rather than a boolean because the review step
 * needs it: a destination can resolve without being an exact option (e.g.
 * "401k fidelity" → "401(k) - Fidelity"), and a <select> whose value matches no
 * <option> renders as nothing selected.
 */
export function resolveAccountName(
  destination: string,
  accountNames: readonly string[],
): string | undefined {
  if (!destination) return undefined;
  const exact = accountNames.find((n) => n === destination);
  if (exact) return exact;
  const target = normalizeAccountName(destination);
  return accountNames.find((n) => normalizeAccountName(n) === target);
}
