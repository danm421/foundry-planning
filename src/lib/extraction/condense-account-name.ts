const MAX_LENGTH = 60;

/**
 * Deterministic backstop for the account-statement prompt's "short name" rule.
 *
 * The prompt asks the model for `custodian + account type` (e.g. "Fidelity
 * Rollover IRA"), but prompt compliance is probabilistic, so this strips the
 * two things that make a non-compliant name unusable — embedded account
 * numbers and unbounded length — without attempting to restructure the name
 * itself.
 *
 * WHERE IT RUNS: `extract.ts` only, on the way out of extraction (both the
 * multi-pass and single-pass paths), before the result is returned and
 * persisted to `payloadJson.fileResults`. It is NOT applied at a replay seam —
 * `run-matching.ts` re-merges the persisted `fileResults` verbatim on every
 * pass — so drafts extracted BEFORE this shipped keep their original
 * verbatim-header names forever. Only re-extraction condenses them.
 *
 * Pure. Idempotent. Never returns empty for a non-empty input: if stripping
 * would erase everything, the trimmed original is returned instead, because a
 * bad name is still more useful to an advisor than no name.
 */
export function condenseAccountName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const stripped = trimmed
    // Masked fragments: XXXX-1234, ****5678, xxxx1234, ...1234
    .replace(/[x*.•]{3,}[-\s]?[a-z0-9]{2,}/gi, " ")
    // Bare runs of 6+ digits (account numbers). Shorter runs are kept so
    // "401k", "403b" and "529" survive.
    .replace(/\b\d{6,}\b/g, " ")
    // Leftover separator debris once a fragment is removed.
    .replace(/[\s\-–—#]+$/g, "")
    .replace(/^[\s\-–—#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const base = stripped || trimmed;
  if (base.length <= MAX_LENGTH) return base;

  // Cut on a word boundary so the result never ends mid-token.
  const cut = base.slice(0, MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}
