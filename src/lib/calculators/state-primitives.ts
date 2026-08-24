/**
 * The parsing primitives every portal calculator's state validator is built
 * from.
 *
 * These are the floor of the anti-mass-assignment rule: a saved calculator
 * payload is client-controlled JSON, and each validator rebuilds its state
 * field by field through these rather than spreading whatever arrived. Two
 * copies of them could drift, and a drift here is a SECURITY drift, not a
 * cosmetic one — so there is exactly one copy.
 */

/** A finite number in [0, max]. Anything else — null, an object, "" — is null. */
export function num(raw: unknown, max: number): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

export function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}
