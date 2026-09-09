import type { BindingRef } from "@/lib/portal/bindings";

/**
 * Which household a multi-bound portal user is currently looking at.
 *
 * Not `httpOnly`-sensitive and not a credential: it selects among households
 * the database already says this login may open. A forged value names a
 * household not in the list and is discarded.
 */
export const ACTIVE_HOUSEHOLD_COOKIE = "foundry_portal_household";

/**
 * Choose the active binding.
 *
 * SECURITY: `bindings` is the authority — it comes from the database, scoped to
 * the authenticated user. `cookieClientId` may only pick *within* it, by exact
 * match (`===`) on `clientId` — never a prefix or case-insensitive match. A
 * cookie naming anything else (including "" or a value only a real clientId
 * starts with) is ignored rather than rejected, so a stale cookie after a
 * disconnect lands the client in a household they still hold instead of a 403.
 *
 * With no usable cookie, falls back to the most recently accepted binding.
 * Ties (equal `acceptedAt`, including two bindings that are both still
 * unaccepted — `acceptedAt: null`) are broken by ascending `bindingId` so the
 * result never depends on the order the caller's list happens to arrive in.
 */
export function pickActiveBinding(
  bindings: BindingRef[],
  cookieClientId: string | null | undefined,
): BindingRef | null {
  if (bindings.length === 0) return null;

  if (cookieClientId) {
    const named = bindings.find((b) => b.clientId === cookieClientId);
    if (named) return named;
  }

  return bindings.reduce((best, b) => {
    const bt = b.acceptedAt?.getTime() ?? 0;
    const bestT = best.acceptedAt?.getTime() ?? 0;
    if (bt !== bestT) return bt > bestT ? b : best;
    return b.bindingId < best.bindingId ? b : best;
  }, bindings[0]);
}
