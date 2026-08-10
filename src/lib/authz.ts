import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { UnauthorizedError } from "./db-helpers";
import { getPortalClientRef } from "@/lib/portal/get-portal-client";
import { roleHasCapability, type Capability } from "./capabilities";
import { currentUserIsBillingContact } from "@/lib/billing/billing-contact";
import { PAST_DUE_GRACE_DAYS } from "@/lib/billing/access-policy";
import { hasClientPortalEntitlement } from "@/lib/billing/entitlements";

/**
 * Forbidden — the caller is authenticated but lacks the required role
 * or active subscription. 403, not 401.
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Billing-contact-only. Used for the Stripe customer portal + billing settings.
 * The contact is a per-firm pointer (publicMetadata.billing_contact_userId),
 * resolved with a lockout-safe fallback — see billing-contact.ts. Replaces the
 * retired requireOrgOwner() (org:owner is no longer a role).
 */
export async function requireBillingContact(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (!(await currentUserIsBillingContact())) {
    throw new ForbiddenError("Billing contact access required");
  }
}

/**
 * Admin-only. Used for firm config, CMA mutations, and team invites.
 * The org:owner role has been retired — all former owners were migrated to
 * org:admin and billing_contact_userId was pinned during the Phase-4 migration.
 */
export async function requireOrgAdminOrOwner(): Promise<void> {
  const { userId, orgRole } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (orgRole !== "org:admin") {
    throw new ForbiddenError("Organization admin role required");
  }
}

/**
 * Generalized role gate. Prefer this over hard-coded role-string checks: it
 * routes through the capability table in `capabilities.ts` so the role→surface
 * mapping has one home. `requireBillingContact`/`requireOrgAdminOrOwner` remain as
 * thin convenience wrappers for existing call sites.
 */
export async function requireCapability(cap: Capability): Promise<void> {
  const { userId, orgRole } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (!roleHasCapability(orgRole, cap)) {
    throw new ForbiddenError(`Capability '${cap}' required`);
  }
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "founder",
  "trialing",
  "active",
  "past_due",
]);

const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

function metaIsActive(meta: Record<string, unknown>): boolean {
  if (meta.is_founder === true) return true;
  const status = typeof meta.subscription_status === "string" ? meta.subscription_status : null;
  if (!status || !ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return false;
  if (status === "past_due") {
    // Aligned with decideAccess: past_due keeps mutation access only inside
    // the dunning grace window, keyed off current_period_end (the same field
    // stateFromMeta uses for pastDueSince). No parseable timestamp → allow,
    // matching decideAccess's pastDueSince === null branch.
    const raw = meta.current_period_end;
    const since = typeof raw === "string" ? new Date(raw) : null;
    if (since && !Number.isNaN(since.getTime())) {
      return Date.now() - since.getTime() < PAST_DUE_GRACE_MS;
    }
  }
  return true;
}

/**
 * Reads is_founder + subscription_status from Clerk org public metadata
 * (via sessionClaims.org_public_metadata — no extra Clerk API call).
 *
 * Founder bypass: returns void if is_founder=true regardless of status.
 * Otherwise throws ForbiddenError if status is not in the active set
 * (trialing, active, past_due within the PAST_DUE_GRACE_DAYS window).
 *
 * NOT WIRED to any route in Phase 2 — exists for tests + Phase 3 wiring.
 * Read-only-during-grace logic for canceled lives in <SubscriptionGuard>
 * (UI hint), not here.
 */
export async function requireActiveSubscription(): Promise<void> {
  const { userId, sessionClaims } = await auth();
  if (!userId) throw new UnauthorizedError();
  const meta =
    (sessionClaims as { org_public_metadata?: Record<string, unknown> })
      ?.org_public_metadata ?? {};
  if (!metaIsActive(meta)) throw new ForbiddenError("Active subscription required");
}

/**
 * Subscription gate keyed to a specific (possibly cross-firm) owning firm.
 * Own org: read sessionClaims.org_public_metadata (fast path, no Clerk call).
 * Other firm: fetch that org's publicMetadata via Clerk and apply the same rule.
 */
export async function requireActiveSubscriptionForFirm(firmId: string): Promise<void> {
  const { userId, orgId, sessionClaims } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (orgId && firmId === orgId) {
    const meta =
      (sessionClaims as { org_public_metadata?: Record<string, unknown> })
        ?.org_public_metadata ?? {};
    if (!metaIsActive(meta)) throw new ForbiddenError("Active subscription required");
    return;
  }
  await requireActiveSubscriptionForFirmNoSession(firmId);
}

/**
 * Same firm-keyed subscription rule as `requireActiveSubscriptionForFirm`, but
 * with NO session requirement — it never calls `auth()` and can therefore never
 * throw `UnauthorizedError`. Reads the firm's publicMetadata straight from Clerk.
 *
 * For PUBLIC, token-authenticated routes only (the emailed risk questionnaire,
 * and any future surface where the token — not a Clerk session — is the whole
 * authority). Such a route has `userId === null` by design, so calling the
 * session-bound variant there throws `UnauthorizedError` on EVERY request and
 * 500s the route; that is not a hypothetical, it shipped once and is exactly
 * what this helper exists to prevent.
 *
 * Costs one Clerk API call — there is no session fast path to take. The only
 * error it raises is ForbiddenError, so a public caller's handler needs just the
 * one catch.
 *
 * NB: the name deliberately contains the substring "requireActiveSubscription"
 * so `active-subscription-lint.test.ts` counts a route using it as gated,
 * without an allowlist entry.
 */
export async function requireActiveSubscriptionForFirmNoSession(firmId: string): Promise<void> {
  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: firmId });
  const meta = (org.publicMetadata as Record<string, unknown>) ?? {};
  if (!metaIsActive(meta)) throw new ForbiddenError("Active subscription required");
}

/** A firm's entitlements straight from Clerk. React.cache'd because the portal
 *  gate runs in two nested layouts plus every `/api/portal/*` handler. */
const firmEntitlements = cache(async (firmId: string): Promise<string[] | null> => {
  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: firmId });
  const raw = (org.publicMetadata as { entitlements?: unknown } | null)?.entitlements;
  return Array.isArray(raw) ? raw.map(String) : null;
});

const PORTAL_NOT_ENTITLED = "Client portal is not enabled for this firm";

/**
 * Client-portal entitlement gate, keyed to the owning firm. The portal is OFF
 * for every firm by default — `client_portal` is not a base entitlement — so
 * this throws unless ops has granted the key to `firmId`.
 *
 * Own org: read sessionClaims.org_public_metadata (the advisor-side callers,
 * no Clerk call). Other firm — including every portal user, who has no orgId of
 * their own: fetch that org's publicMetadata via Clerk.
 */
export async function requireClientPortalEntitlement(firmId: string): Promise<void> {
  const { userId, orgId, sessionClaims } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (orgId && firmId === orgId) {
    const meta =
      (sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null)
        ?.org_public_metadata ?? {};
    if (!hasClientPortalEntitlement(meta.entitlements)) {
      throw new ForbiddenError(PORTAL_NOT_ENTITLED);
    }
    return;
  }
  if (!hasClientPortalEntitlement(await firmEntitlements(firmId))) {
    throw new ForbiddenError(PORTAL_NOT_ENTITLED);
  }
}

/**
 * Non-throwing read of the CALLER'S OWN org client-portal entitlement, for
 * advisor-side UI that hides the portal surface rather than denying it. Reads
 * sessionClaims only — no Clerk call. Never use it to authorize a mutation;
 * `requireClientPortalEntitlement` is the gate.
 */
export async function currentOrgHasClientPortal(): Promise<boolean> {
  const { sessionClaims } = await auth();
  const meta =
    (sessionClaims as { org_public_metadata?: { entitlements?: string[] } } | null)
      ?.org_public_metadata ?? {};
  return hasClientPortalEntitlement(meta.entitlements);
}

/**
 * Portal-user gate. Returns the bound clientId for the session, or
 * throws — UnauthorizedError if no session, ForbiddenError otherwise
 * (advisor session, signed-in user with no clients.clerk_user_id, or a firm
 * whose `client_portal` entitlement is off).
 *
 * The entitlement check lives HERE rather than at each call site because this
 * is the single chokepoint for both `/portal/*` pages and every
 * `/api/portal/*` route handler — an ops revoke goes fully dark in one place,
 * and an already-bound client is not grandfathered. Pairs with the middleware
 * branch that routes portal users to `/portal`.
 */
export async function requireClientPortalAccess(): Promise<{
  clientId: string;
  clerkUserId: string;
}> {
  const { userId, orgId } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (orgId) {
    throw new ForbiddenError("Advisor session — portal access denied");
  }
  const ref = await getPortalClientRef(userId);
  if (!ref) {
    throw new ForbiddenError("No portal binding for this user");
  }
  // Fail closed: an unowned client has no firm whose entitlement could allow it.
  if (!ref.firmId) {
    throw new ForbiddenError("No firm for this client");
  }
  await requireClientPortalEntitlement(ref.firmId);
  return { clientId: ref.id, clerkUserId: userId };
}

/**
 * True only for the two errors the access gates raise as a *decision*: no
 * session (`UnauthorizedError`) and not-found-or-denied (`ForbiddenError` —
 * deliberately merged so client existence never leaks across firms).
 *
 * Anything else a gate can throw is a fault: a dropped connection, a column
 * the deployed schema lacks, a driver error.
 */
export function isAccessDenial(err: unknown): boolean {
  return err instanceof UnauthorizedError || err instanceof ForbiddenError;
}

/**
 * `.catch()` handler for callers that degrade an access denial into
 * "not found" — `requireClientAccess(id).catch(nullOnAccessDenial)`.
 *
 * Use this instead of a bare `.catch(() => null)`, which also swallows every
 * DB fault and reports an outage as "this client doesn't exist". That is
 * exactly what made the 2026-07-30 prod incident (migrations 0227/0228 merged
 * but never applied, so `select *` on `clients` threw 42703) present as a
 * routing bug for as long as it did.
 */
export function nullOnAccessDenial(err: unknown): null {
  if (isAccessDenial(err)) return null;
  throw err;
}

/**
 * Turn an auth-related thrown error into an HTTP response tuple that
 * route handlers can short-circuit with. Returns null when the error
 * isn't one of ours.
 */
export function authErrorResponse(err: unknown):
  | { status: 401 | 403; body: { error: string } }
  | null {
  if (err instanceof UnauthorizedError) return { status: 401, body: { error: "Unauthorized" } };
  if (err instanceof ForbiddenError) return { status: 403, body: { error: err.message } };
  // Legacy thrown Error("Unauthorized") instances.
  if (err instanceof Error && err.message === "Unauthorized") {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  return null;
}
