import { cache } from "react";
import { cookies } from "next/headers";
import { listActiveBindings, type BindingRef } from "@/lib/portal/bindings";
import { pickActiveBinding, ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/portal/active-household";
import { legacyPortalClientRef } from "@/lib/portal/legacy-binding";

/** Every household this login may open, newest acceptance first. Cached per request. */
export const getPortalBindings = cache(
  async (clerkUserId: string): Promise<BindingRef[]> => {
    if (!clerkUserId) return [];
    return listActiveBindings(clerkUserId);
  },
);

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

  const bindings = await getPortalBindings(clerkUserId);

  if (bindings.length === 0) {
    // Deploy-1 fallback only, and ONLY on an empty binding list: a client whose
    // 0263 backfill row somehow went missing must not be locked out mid-deploy.
    // Removed in Task 15.
    return legacyPortalClientRef(clerkUserId);
  }

  const selected = (await cookies()).get(ACTIVE_HOUSEHOLD_COOKIE)?.value ?? null;
  const active = pickActiveBinding(bindings, selected);
  if (!active) return null;

  return { id: active.clientId, firmId: active.firmId, advisorId: active.advisorId };
});

/** The active `clients.id` alone. Shares the cached lookup above. */
export async function getPortalClientId(clerkUserId: string): Promise<string | null> {
  return (await getPortalClientRef(clerkUserId))?.id ?? null;
}
