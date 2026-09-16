/**
 * What counts as an account's masked number.
 *
 * A statement prints plenty of other digits the extractor is happy to copy
 * into `accountNumberLast4`: a 401(k)'s six-digit plan GROUP number, a
 * five-digit contract number, a three-digit sub-plan id. About 8% of extracted
 * rows carry one. They are not this account's identity, and anything that
 * keys on them as though they were folds unrelated accounts together.
 */

/**
 * The row's real masked account number, or null when the field holds
 * something that is not one. Exactly four digits — the same shape
 * `src/lib/crm/schemas.ts` already enforces on the CRM's own field.
 *
 * NOT `condense-account-name.ts`'s `normalizeLast4`, which takes the LAST four
 * characters of whatever it is given: that turns the group number "433350"
 * into a plausible-looking "3350" on purpose, because it is building a display
 * NAME ("ESOP x3350") and a wrong-looking suffix is better than none. This one
 * decides IDENTITY, where inventing four digits is how two accounts become
 * one.
 */
export function realLast4(raw: string | undefined): string | null {
  return raw !== undefined && /^\d{4}$/.test(raw) ? raw : null;
}

/**
 * The same decision as `realLast4`, but tolerant of the packaging a model
 * leaves around a number it read correctly: padding (`" 1234"`), or the mask
 * the statement printed in front of it (`"x1234"`, `"****1234"`, `"XXXX-1234"`).
 *
 * Only the WRAPPER is forgiven. Nothing here invents digits: "433350" is six
 * digits with no mask to strip and still returns null, and UBS's "IJ 58621 FI"
 * has no trailing four-digit run at all. That is the line `realLast4` draws and
 * this keeps — the point is to stop a correctly-read number from being thrown
 * away over a stray "x", not to widen what counts as a number.
 */
export function accountLast4(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return realLast4(raw.trim().replace(/^[x*.•\s#-]+/i, ""));
}

/**
 * How far the digits may sit from the label that vouches for them. Wide enough
 * for the full account number a statement prints in front of its last four
 * ("Account number: 8747780479"), narrow enough that the label cannot be a
 * different line of the page.
 */
const LABEL_DISTANCE = 36;

/**
 * An account-identity label sitting immediately in front of the digits: the
 * word, an optional "number"/"id", then nothing but separators, other digits
 * of the same number, and mask characters.
 *
 * NO INTERVENING WORD is the clause that does the work, and it was measured
 * missing. Without it, "Your Account Value $126,591.46" one line above a
 * footer code vouches for the footer code — the word "account" is 30
 * characters away and the rule could not tell that "Value" stands between
 * them. With it, the label has to actually be labelling these digits.
 *
 * `x` is exempt from "no intervening word" because it is not a word here: it
 * is the mask Vanguard prints in "brokerage account—XXXX7893". Under the `i`
 * flag `[^a-z]` excludes BOTH cases, so the exemption has to name it.
 *
 * "Loan" earns its place beside "account": a mortgage statement's number is
 * the one an advisor reconciles a liability against, and it is never called an
 * account number.
 */
const ACCOUNT_LABEL = new RegExp(
  String.raw`(?:account|acct|loan)(?:\s*(?:number|numbers|no|num|id|#))?(?:[^a-z]|x){0,${LABEL_DISTANCE}}$`,
  "i",
);

/**
 * The mask a statement prints in front of digits it is deliberately showing
 * only the tail of — Vanguard's "XXXX7893", Capital One's "Checking...6891",
 * HSA Bank's "xxxxxx9176". This is the clause that stands alone: HSA Bank's
 * number has no label anywhere near it (the statement's two-column layout puts
 * "Account ID:" a service address away), and Capital One's summary table names
 * the account but never the word "number". Two or more mask characters, so the
 * lone decimal point in "$318.25" is not read as a mask.
 */
const PRINTED_MASK = /(?:[x*#•…]{2,}|\.{2,})[ \t]?$/i;

/**
 * Whether the document's own text vouches for `last4` being the account's
 * number, rather than something else four digits long that the model copied
 * into the field.
 *
 * Shape cannot settle this — a plan number, a contract number and the
 * page-imposition code in a statement's footer are all four digits, and about
 * 8% of extracted rows carry one. What separates them is how the page PRINTS
 * the number: an account number arrives behind a label ("Account number:
 * 8747780479", "Loan Number: 8104933596") or behind a mask ("XXXX7893"), and a
 * plan number arrives behind the word "Plan" or behind nothing at all
 * ("00007265 2026202 4", a bare footer code).
 *
 * ANY ONE occurrence vouching is enough. A statement routinely prints its
 * account number a dozen times, most of them bare — in a running header, in a
 * table row, on a remittance stub. Requiring every occurrence to be labelled
 * would clear almost every real number in the corpus.
 *
 * A number that occurs NOWHERE in the text fails this for free, which is the
 * outright fabrication: the extractor reported "x6780" for a Stantec 401(k)
 * whose 32,264 characters of text do not contain "6780" anywhere.
 *
 * THE CALLER OWES THIS COMPLETE TEXT. Absence is only evidence when the whole
 * document is on hand — judged against a truncated copy, or against a document
 * whose trailing pages were dropped, this clears real numbers. See
 * `judgeableText` in `merge-across-files.ts`, which is the only caller and
 * refuses every incomplete case.
 */
export function documentVouchesForLast4(text: string, last4: string): boolean {
  // Both patterns are anchored at the digits with `$`, so they read backwards
  // from each occurrence. The slice is only there to keep the string short —
  // `LABEL_DISTANCE` is what actually bounds how far either one can reach.
  const window = LABEL_DISTANCE + 16;
  for (let at = text.indexOf(last4); at !== -1; at = text.indexOf(last4, at + 1)) {
    const before = text.slice(Math.max(0, at - window), at);
    if (ACCOUNT_LABEL.test(before) || PRINTED_MASK.test(before)) return true;
  }
  return false;
}
