import { auth, clerkClient } from "@clerk/nextjs/server";
import { UnauthorizedError } from "./db-helpers";
import { getPortalClientId } from "@/lib/portal/get-portal-client";
import { roleHasCapability, type Capability } from "./capabilities";
import { currentUserIsBillingContact } from "@/lib/billing/billing-contact";

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

function metaIsActive(meta: Record<string, unknown>): boolean {
  if (meta.is_founder === true) return true;
  const status = typeof meta.subscription_status === "string" ? meta.subscription_status : null;
  return !!status && ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

/**
 * Reads is_founder + subscription_status from Clerk org public metadata
 * (via sessionClaims.org_public_metadata — no extra Clerk API call).
 *
 * Founder bypass: returns void if is_founder=true regardless of status.
 * Otherwise throws ForbiddenError if status is not in the active set
 * (trialing, active, past_due).
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
  let meta: Record<string, unknown>;
  if (orgId && firmId === orgId) {
    meta =
      (sessionClaims as { org_public_metadata?: Record<string, unknown> })
        ?.org_public_metadata ?? {};
  } else {
    const cc = await clerkClient();
    const org = await cc.organizations.getOrganization({ organizationId: firmId });
    meta = (org.publicMetadata as Record<string, unknown>) ?? {};
  }
  if (!metaIsActive(meta)) throw new ForbiddenError("Active subscription required");
}

/**
 * Portal-user gate. Returns the bound clientId for the session, or
 * throws — UnauthorizedError if no session, ForbiddenError otherwise
 * (advisor session, or signed-in user with no clients.clerk_user_id).
 *
 * Used by `/portal/*` pages and `/api/portal/*` route handlers. Pairs
 * with the middleware branch that routes portal users to `/portal`.
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
  const clientId = await getPortalClientId(userId);
  if (!clientId) {
    throw new ForbiddenError("No portal binding for this user");
  }
  return { clientId, clerkUserId: userId };
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
