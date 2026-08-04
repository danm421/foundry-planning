const MAX_LENGTH = 60;

/**
 * Mask fronting the last-4 suffix, e.g. "Rollover IRA ••••1234". Must stay a
 * character `condenseAccountName` already strips, or `composeAccountName` stops
 * being idempotent.
 */
const LAST4_MASK = "••••";

/**
 * Deterministic backstop for the account-statement prompt's "short name" rule.
 *
 * The prompt asks the model for the account type alone (e.g. "Rollover IRA"),
 * but prompt compliance is probabilistic, so this strips the two things that
 * make a non-compliant name unusable — embedded account numbers and unbounded
 * length — without attempting to restructure the name itself. Removing a
 * custodian the model added anyway is `composeAccountName`'s job, because that
 * needs the extracted `custodian` field this function never sees.
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

  return truncateOnWordBoundary(stripped || trimmed, MAX_LENGTH);
}

/** Cut on a word boundary so the result never ends mid-token. */
function truncateOnWordBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Alphanumeric runs with their offsets, so a leading/trailing run can be sliced
 * off the ORIGINAL string and keep its casing and inner punctuation.
 */
function wordSpans(s: string): Array<{ word: string; start: number; end: number }> {
  return Array.from(s.matchAll(/[a-z0-9]+/gi), (m) => ({
    word: m[0].toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/**
 * Remove the custodian from an extracted account name.
 *
 * Advisors don't want the institution in the name — it has its own `custodian`
 * field and its own column on the account — and on a fact finder the model was
 * inventing one to satisfy the old "custodian + account type" rule. The prompt
 * now asks for the type alone; this is the deterministic backstop, in the same
 * spirit as the number-stripping above.
 *
 * Only words the extracted custodian itself contains are removed, and only from
 * the ends: "Schwab Joint Brokerage" -> "Joint Brokerage" and "Joint Brokerage
 * - Schwab" -> "Joint Brokerage", while a custodian of "Chase" leaves "Bank
 * Loan Reserve" whole. Returns the input unchanged when the custodian is
 * unknown or would consume the entire name ("Fidelity" at Fidelity) — a
 * custodian-only name still beats an empty one.
 */
function stripCustodian(name: string, custodian: string | null | undefined): string {
  if (typeof custodian !== "string") return name;
  const custodianWords = new Set(wordSpans(custodian).map((w) => w.word));
  if (custodianWords.size === 0) return name;

  const spans = wordSpans(name);
  const first = spans.findIndex((s) => !custodianWords.has(s.word));
  if (first < 0) return name;
  let last = spans.length - 1;
  while (last > first && custodianWords.has(spans[last].word)) last -= 1;

  return name.slice(spans[first].start, spans[last].end).trim();
}

/**
 * The last 4 characters worth printing: alphanumerics only, so a model that
 * answers "****1234" or "XXXX-1234" doesn't produce a double-masked suffix.
 * Only shapes the display name — the stored `accountNumberLast4` is untouched,
 * because account matching compares it verbatim.
 */
function normalizeLast4(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[^a-z0-9]/gi, "").slice(-4);
}

/**
 * The account display name as extraction should emit it: the account type,
 * without the custodian, followed by the masked last 4 when the document showed
 * one — "Rollover IRA ••••1234".
 *
 * Pure and idempotent: `condenseAccountName` strips the mask this appends, so
 * re-running over an already-composed name reproduces it. Total length stays
 * within the same 60-char cap `condenseAccountName` enforces.
 */
export function composeAccountName(
  raw: string,
  custodian?: string | null,
  accountNumberLast4?: string | null,
): string {
  const base = stripCustodian(condenseAccountName(raw), custodian);
  const last4 = normalizeLast4(accountNumberLast4);
  if (!last4) return base;

  // The digits are sometimes left in the name too. Condensing removes masked
  // forms but keeps a bare 4-digit run (401k/529 have to survive), so drop a
  // trailing repeat — with any mask that fronts it, or "XXXX-1234" (which
  // condenseAccountName returns whole via its never-empty fallback) would leave
  // "XXXX" behind.
  //
  // The mask is one-or-more characters, not two-or-more: planning-software
  // reports label accounts with a SINGLE "x" ("Inh. IRA x7254", "Taxable
  // Account x0028"), a form `condenseAccountName` also leaves alone because its
  // own mask rule needs three. Missing it printed the number twice —
  // "Inh. IRA x7254 ••••7254".
  //
  // The digits must open at a separator, a mask, or the string start — hence
  // the leading alternation rather than `\b`, which would also match INSIDE a
  // longer run and rename "Portfolio 17254" to "Portfolio 1".
  const deduped = base
    .replace(new RegExp(`(?:^|[\\s\\-–—#]+)(?:[x*.•]+[\\s\\-–—#]*)?${last4}\\b\\s*$`, "i"), "")
    .trim();
  const suffix = `${LAST4_MASK}${last4}`;
  if (!deduped) return suffix;
  return `${truncateOnWordBoundary(deduped, MAX_LENGTH - suffix.length - 1)} ${suffix}`;
}
