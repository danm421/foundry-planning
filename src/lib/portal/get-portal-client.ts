import { cache } from "react";
import { cookies } from "next/headers";
import { listBindingsForUser, type BindingRef, type BindingRow } from "@/lib/portal/bindings";
import { pickActiveBinding, ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/portal/active-household";
import { legacyPortalClientRef } from "@/lib/portal/legacy-binding";

/**
 * Every binding row this login has, in ANY status. Cached per request.
 *
 * Internal on purpose: callers want either "which households may they open"
 * (`getPortalBindings`) or "do they have any history at all" (the legacy
 * fallback condition below). One query serves both.
 */
const getAllPortalBindings = cache(
  async (clerkUserId: string): Promise<BindingRow[]> => {
    if (!clerkUserId) return [];
    return listBindingsForUser(clerkUserId);
  },
);

/** Every household this login may open, newest acceptance first. Cached per request. */
export async function getPortalBindings(clerkUserId: string): Promise<BindingRef[]> {
  return (await getAllPortalBindings(clerkUserId)).filter((b) => b.status === "active");
}

/**
 * The household this portal request is about: the ACTIVE binding.
 *
 * Signature unchanged from the pre-0263 version so every caller — `proxy.ts`,
 * layouts, route handlers, the auth gates — keeps working. What changed is that
 * a user may now hold several bindings, and one of them is selected.
 *
 * The cookie NEVER widens access: `pickActiveBinding` can only return something
 * already in the list this function read for the authenticated user.
 *
 * `cookies()` IS callable from `src/proxy.ts`. Next 16's proxy/middleware
 * adapter runs the handler inside a `type: 'request'` work-unit store
 * (`createRequestStoreForAPI` in `server/async-storage/request-store.js`,
 * entered at `server/web/adapter.js`), which is exactly the store
 * `next/headers`' `cookies()` reads — so it resolves rather than throwing
 * "called outside a request scope". Verified against a running dev server on
 * 2026-09-09: a probe inside this app's proxy handler read the real incoming
 * `foundry_portal_household` cookie. Do not "defensively" wrap this in a
 * try/catch — that would swallow a genuine request-scope regression.
 */
export const getPortalClientRef = cache(async (
  clerkUserId: string,
): Promise<{ id: string; firmId: string | null; advisorId: string } | null> => {
  if (!clerkUserId) return null;

  const all = await getAllPortalBindings(clerkUserId);

  // Deploy-1 fallback, and ONLY for a user with NO binding rows in ANY status:
  // that is the one whose 0263 backfill row went missing, and locking them out
  // mid-deploy is the risk this exists to cover. The condition is deliberately
  // NOT "no active bindings" — revoking a binding leaves a `revoked` row and
  // does not clear the legacy column, so an active-only test would read that
  // column and hand the household straight back to a client their advisor just
  // removed, silently making both revoke paths no-ops. Any history at all means
  // `portal_bindings` is authoritative for this user. Removed in Task 15.
  if (all.length === 0) return legacyPortalClientRef(clerkUserId);

  const active = all.filter((b) => b.status === "active");
  const selected = (await cookies()).get(ACTIVE_HOUSEHOLD_COOKIE)?.value ?? null;
  const binding = pickActiveBinding(active, selected);
  if (!binding) return null;

  // All three fields come from the SELECTED binding. `firmId` and `advisorId`
  // are what `requireClientPortalAccess` authorizes against, so taking either
  // from a different row would check the active household against another
  // firm's entitlement.
  return { id: binding.clientId, firmId: binding.firmId, advisorId: binding.advisorId };
});

/** The active `clients.id` alone. Shares the cached lookup above. */
export async function getPortalClientId(clerkUserId: string): Promise<string | null> {
  return (await getPortalClientRef(clerkUserId))?.id ?? null;
}
