import { auth } from "@clerk/nextjs/server";
import { UnauthorizedError } from "./db-helpers";
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
  if (meta.is_founder === true) return;
  const status = typeof meta.subscription_status === "string"
    ? meta.subscription_status
    : null;
  if (!status || !ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
    throw new ForbiddenError("Active subscription required");
  }
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
