/**
 * Scenario-change payload fields that are internal plumbing and must never be
 * printed to a reader.
 *
 * `asset_transaction.bundleId` links the legs of one dialog save so the Solver
 * can render them as ONE technique. It rides the change payload on purpose —
 * promote needs it to keep the legs bundled — but it is a raw uuid with no
 * meaning to anyone reading a change list, and every describer renders an
 * unrecognised field generically ("Bundle id: — → 7f3a91c2-…").
 *
 * Keyed by `targetKind`, never blanket: a kind that legitimately owns a field
 * of the same name must keep printing it.
 */
const HIDDEN_FIELDS_BY_KIND: Record<string, readonly string[]> = {
  asset_transaction: ["bundleId"],
};

/** The edit payload with that kind's unprintable fields removed. */
export function visibleChangeFields<T>(
  targetKind: string,
  payload: Record<string, T>,
): Record<string, T> {
  const hidden = HIDDEN_FIELDS_BY_KIND[targetKind];
  if (!hidden) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([f]) => !hidden.includes(f)));
}
