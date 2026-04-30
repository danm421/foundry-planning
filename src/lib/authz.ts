import { auth } from "@clerk/nextjs/server";
import { UnauthorizedError } from "./db-helpers";

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
 * Owner-only. Used for billing routes and any future owner-promotion
 * paths. UnauthorizedError on no session, ForbiddenError on
 * authenticated-but-not-owner.
 */
export async function requireOrgOwner(): Promise<void> {
  const { userId, orgRole } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (orgRole !== "org:owner") {
    throw new ForbiddenError("Organization owner role required");
  }
}

/**
 * Admin OR Owner. Used for firm config, CMA mutations, and team invites.
 * Replaces the old requireOrgAdmin() — owner now passes too, so the
 * founder (org:owner) can still edit CMA.
 */
export async function requireOrgAdminOrOwner(): Promise<void> {
  const { userId, orgRole } = await auth();
  if (!userId) throw new UnauthorizedError();
  if (orgRole !== "org:admin" && orgRole !== "org:owner") {
    throw new ForbiddenError("Organization admin or owner role required");
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
