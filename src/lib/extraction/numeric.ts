/**
 * THE rule for "this extracted field is a number", and the only place it is
 * spelled out.
 *
 * It lives here — beside `realLast4` in `account-number.ts`, with no imports of
 * its own so any client component can reach it — because the extraction schema
 * is a `looseObject` that types no field at all
 * (`extraction-schema.ts`): a field declared `number` can arrive as a string,
 * and `+` over a string CONCATENATES rather than adds. That is not a
 * hypothetical — it put a 923x-wrong figure on a real plan.
 *
 * Two consumers that must agree, which is why it is shared rather than copied:
 *   - `entity-extraction/placement.ts` coerces a model's observation before
 *     scoring and placing it, and
 *   - `statement-chat/column-totals.ts` sums the values a review table is
 *     showing, so the figure under a column agrees with the cells in it.
 *
 * Note what it deliberately does NOT decide: whether a number is WANTED.
 * `numericAmount` in `imports/living-rows.ts` keeps its own `> 0` test because
 * a living-expense row of zero is noise, while an account balance of zero is a
 * real reading — a paystub names the direct-deposit account but never prints a
 * balance. One coercion, separate policies; folding the policy in here is what
 * made that rule look like a different one.
 */
export function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (!text) return null;
  // Accounting negatives: ($1,200.00)
  const parenthesised = /^\((.*)\)$/.exec(text);
  const negative = Boolean(parenthesised);
  if (parenthesised) text = parenthesised[1];
  text = text.replace(/[$,\s%]/g, "");
  // Rejects "1e5" and "0x10" as well as prose — a model that returns exponent
  // notation for a dollar figure is not reporting a balance this can trust.
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}
